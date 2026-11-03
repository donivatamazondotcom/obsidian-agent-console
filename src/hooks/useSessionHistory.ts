import {
	useState,
	useCallback,
	useRef,
	useMemo,
	useEffect,
} from "react";
import type { AcpClient } from "../acp/acp-client";
import type { ISettingsAccess } from "../services/settings-service";
import type {
	SessionInfo,
	ListSessionsResult,
	ChatSession,
	AgentCapabilities,
} from "../types/session";
import { SessionStore } from "../services/session-store";
import { findSessionRecord, newRecordId } from "../services/session-record";
import { getLogger } from "../utils/logger";
import { NO_AGENT_CAPABILITIES } from "../types/session";
import type { SessionListSource } from "../resolvers/session-history-view";
import {
	resolveHistoryCapabilities,
	type HistoryCapabilities,
} from "../resolvers/history-capabilities";
import { resolveAgentLaunchKey } from "../services/session-helpers";
import type { ChatMessage } from "../types/chat";
import { extractErrorMessage } from "../utils/error-utils";
import { overlayLocalTitles } from "../resolvers/session-title";
import type { ContextNote } from "../types/context";
import { t } from "../i18n";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for useSessionHistory hook.
 */
export interface UseSessionHistoryOptions {
	/** Agent client for session operations */
	agentClient: AcpClient;
	/** Current session (used to access agentCapabilities and agentId) */
	session: ChatSession;
	/** Settings access for local session storage */
	settingsAccess: ISettingsAccess;
	/** Agent working directory — used for saving new session metadata */
	agentCwd: string;

	/**
	 * The agent's own title for a session this tab restored from the agent's
	 * session list without a local record (I223). Every save forwards it to
	 * the single writer as a create-only seed, so the record is created under
	 * the agent's title instead of the first replayed message. It never
	 * overrides an existing title.
	 */
	restoredAgentTitle?: string | null;

	/**
	 * The agent session id this tab was restored with (I269). Binds the tab
	 * to its history record at mount when the tab state carries no record id
	 * (tabs saved before I269). Matched against records' `sessionId` only.
	 */
	restoredSessionId?: string | null;

	/**
	 * The history record this tab wrote to, from its persisted tab state
	 * (I269). Wins over `restoredSessionId`.
	 */
	restoredRecordId?: string | null;

	/**
	 * Called whenever the tab's record binding changes (I269): bound at
	 * mount, minted or adopted on a write, dropped by a reset. ChatView
	 * persists it with the tab state.
	 */
	onRecordIdChange?: (recordId: string | null) => void;
}

/**
 * Return type for useSessionHistory hook.
 */
export interface UseSessionHistoryReturn {
	/** List of sessions */
	sessions: SessionInfo[];
	/** Whether sessions are being fetched */
	loading: boolean;
	/** Error message if fetch fails */
	error: string | null;
	/** Whether there are more sessions to load */
	hasMore: boolean;

	/**
	 * The normalized agent-capability record (Track B / I117). The Session
	 * History view decision is derived from this via `deriveSessionHistoryView`
	 * — consumers read the resolver output, not the individual flags below.
	 */
	capabilities: AgentCapabilities;

	/**
	 * What the Session history VIEW gates on (I260): the live record, else
	 * the record this launch reported at its last `initialize`, else
	 * `unknown`. Lets a tab that hasn't connected offer its Agent view. Agent
	 * calls keep reading {@link capabilities} (live only).
	 */
	historyCapabilities: HistoryCapabilities;

	// Capability flags (from session.agentCapabilities)
	/** Whether session history UI should be shown */
	canShowSessionHistory: boolean;
	/** Whether session can be restored (load or resume supported) */
	canRestore: boolean;
	/** Whether session/fork is supported (unstable) */
	canFork: boolean;
	/** Whether session/list is supported (unstable) */
	canList: boolean;
	/** Whether sessions are from local storage (agent doesn't support list) */
	isUsingLocalSessions: boolean;

	/** Set of session IDs that have local data (for UI filtering) */
	localSessionIds: Set<string>;

	/**
	 * Fetch the session list for the chosen source.
	 * Replaces existing sessions in state.
	 * @param source - "local" (the unified local store, every agent) or
	 *   "agent" (the agent's server-side session/list). Defaults to Local for
	 *   every agent; falls back to Local when the agent cannot list.
	 * @param cwd - Optional working-directory filter (Agent view only).
	 */
	fetchSessions: (source: SessionListSource, cwd?: string) => Promise<void>;

	/**
	 * Load more sessions (pagination).
	 * Appends to existing sessions list.
	 */
	loadMoreSessions: () => Promise<void>;

	/**
	 * The history record this tab writes to (I269), or null before its
	 * first message. Persisted with the tab state.
	 */
	getRecordId: () => string | null;

	/**
	 * Move this tab's record to a new agent session after a fallback (I269),
	 * before the tab goes ready. No record yet: nothing to move (decision a).
	 */
	rebindRecord: (sessionId: string, kiroEngine?: "v2" | "v3") => void;

	/**
	 * Forget the tab's record (New chat, agent switch, hard reload): the next
	 * message starts a new record.
	 */
	resetRecordBinding: () => void;

	/**
	 * Delete a session (local metadata + message file).
	 * @param sessionId - Session to delete
	 */
	deleteSession: (sessionId: string) => Promise<void>;

	/**
	 * Update the title of a saved session.
	 * @param sessionId - Session to update
	 * @param newTitle - New title string
	 * @param sessionCwd - Original cwd of the session (used when creating a new local entry)
	 */
	updateSessionTitle: (
		sessionId: string,
		newTitle: string,
		sessionCwd: string,
	) => Promise<void>;

	/**
	 * Save session metadata locally.
	 * Called when the first message is sent in a new session.
	 * @param sessionId - Session ID to save
	 * @param messageContent - First message content (used to generate title)
	 */
	saveSessionLocally: (
		sessionId: string,
		messageContent: string,
	) => Promise<void>;

	/**
	 * Save session messages locally.
	 * Called when a turn ends (agent response complete).
	 * @param sessionId - Session ID
	 * @param messages - Messages to save
	 * @param contextNotes - Crystallized context notes for the session
	 * @param suggestedTitle - Resolved AI title to set as the record title
	 *   (I114). When omitted, the existing title is preserved.
	 */
	saveSessionMessages: (
		sessionId: string,
		messages: import("../types/chat").ChatMessage[],
		contextNotes?: ContextNote[],
		suggestedTitle?: string | null,
	) => Promise<void>;

	/**
	 * Propagate a resolved AI-suggested title to the session-history record
	 * (I114). Serialized through the same single writer as the message saves,
	 * so it can neither clobber nor be clobbered by a concurrent save.
	 * @param sessionId - Session ID
	 * @param suggestedTitle - The resolved AI title
	 * @param sessionCwd - Working directory (used when creating a new entry)
	 */
	applySessionTitle: (
		sessionId: string,
		suggestedTitle: string,
		sessionCwd: string,
	) => void;

	/**
	 * Invalidate the session cache.
	 * Call this when creating a new session to refresh the list.
	 */
	invalidateCache: () => void;

	/**
	 * Load a session's persisted messages from local storage.
	 * Exposed for full-text search indexing (see session-search service).
	 */
	loadSessionMessages: (
		sessionId: string,
	) => Promise<import("../types/chat").ChatMessage[] | null>;

	/**
	 * Mirror the agent's `session/list` metadata into the local cache. Call on
	 * connect for a listing agent; powers the disconnected Agent view.
	 */
	syncAgentSessionMetaCache: () => Promise<void>;
}

/**
 * Cache entry for session list.
 */
interface SessionCache {
	sessions: SessionInfo[];
	nextCursor?: string;
	cwd?: string;
	timestamp: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Cache expiry time in milliseconds (5 minutes) */
const CACHE_EXPIRY_MS = 5 * 60 * 1000;

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing session history.
 *
 * Handles listing, loading, resuming, forking, and caching of previous chat sessions.
 * Integrates with the agent client to fetch session metadata and
 * load previous conversations.
 *
 * Capability detection is based on session.agentCapabilities, which is set
 * during initialization and persists for the session lifetime.
 *
 * @param options - Hook options including agentClient, session, and onSessionLoad
 */
export function useSessionHistory(
	options: UseSessionHistoryOptions,
): UseSessionHistoryReturn {
	const {
		agentClient,
		session,
		settingsAccess,
		agentCwd,
		restoredAgentTitle,
		restoredSessionId,
		restoredRecordId,
		onRecordIdChange,
	} = options;

	// Consume the normalized capability record produced once at the acp/ edge.
	// Never reads the raw SDK capability bag; defaults to the all-false record
	// before initialize resolves.
	const capabilities: AgentCapabilities = useMemo(
		() => session.capabilities ?? NO_AGENT_CAPABILITIES,
		[session.capabilities],
	);

	// I260: the history view must not read "not connected yet" as "can't
	// list sessions". Fall back to what this launch reported at its last
	// initialize, keyed by launch (command + Kiro engine), never agent id.
	// Read during render: the host re-renders on every settings change
	// (ChatPanel's useSettings), and the snapshot is a stable object, so the
	// memo below only recomputes when the cached record itself changes.
	let cachedCapabilities: AgentCapabilities | undefined;
	if (!session.capabilities && session.agentId) {
		const snapshot = settingsAccess.getSnapshot();
		const key = resolveAgentLaunchKey(snapshot, session.agentId);
		cachedCapabilities = key
			? snapshot.agentCapabilityCache[key]?.capabilities
			: undefined;
	}
	const historyCapabilities: HistoryCapabilities = useMemo(
		() =>
			resolveHistoryCapabilities(session.capabilities, cachedCapabilities),
		[session.capabilities, cachedCapabilities],
	);

	// I260: remember what this launch reported, so the next unconnected tab
	// for it can gate on it. Written once per change; the agent client owns
	// the real launch key (its live config, not settings edited since).
	useEffect(() => {
		const live = session.capabilities;
		if (!live) return;
		const key = agentClient.getLaunchKey();
		if (!key) return;
		const cache = settingsAccess.getSnapshot().agentCapabilityCache;
		const saved = cache[key]?.capabilities;
		if (saved && sameCapabilities(saved, live)) return;
		void settingsAccess.updateSettings({
			agentCapabilityCache: {
				...cache,
				[key]: {
					capabilities: live,
					learnedAt: new Date().toISOString(),
				},
			},
		});
	}, [agentClient, session.capabilities, settingsAccess]);

	// I114: single serialized writer of record for savedSessions metadata.
	// All metadata/title writes from the racing turn-end / debounced / AI-title
	// paths go through this owner so no writer acts on a stale snapshot.
	// Shared single writer of record (I114 / Phase 4 §2c). Prefer the one
	// instance owned by SettingsService so every consumer — all
	// useSessionHistory mounts AND ChatView's tab rename — serializes through
	// the same queue. Fall back to a local instance only for minimal test
	// fakes that don't supply one.
	const sessionStore = useMemo(
		() => settingsAccess.sessionStore ?? new SessionStore(settingsAccess),
		[settingsAccess],
	);

	// ============================================================
	// Record binding (I269)
	// ============================================================
	// The history record this tab writes to. One chat keeps one record across
	// every agent session id it passes through, so the binding survives
	// fallbacks, idle release and reconnects; only a reset (New chat, agent
	// switch, hard reload) drops it. Starts from the persisted tab state, then
	// from the record whose `sessionId` is the restored id.
	const recordIdRef = useRef<string | null | undefined>(undefined);
	if (recordIdRef.current === undefined) {
		recordIdRef.current =
			restoredRecordId ||
			(restoredSessionId
				? findSessionRecord(settingsAccess.getSavedSessions(), {
						by: "sessionId",
						id: restoredSessionId,
					})?.recordId
				: undefined) ||
			null;
	}

	const onRecordIdChangeRef = useRef(onRecordIdChange);
	onRecordIdChangeRef.current = onRecordIdChange;
	const setBinding = useCallback((id: string | null) => {
		if (recordIdRef.current === id) return;
		recordIdRef.current = id;
		onRecordIdChangeRef.current?.(id);
	}, []);
	// Report the mount binding once, so the tab state always carries it.
	useEffect(() => {
		onRecordIdChangeRef.current?.(recordIdRef.current ?? null);
	}, []);

	/**
	 * The record id a write with messages uses: the bound one, else the
	 * record already holding this agent session (adopted), else a new id.
	 * Decided synchronously so the message file and the metadata agree.
	 */
	const bindRecordId = useCallback(
		(sessionId: string): string => {
			if (recordIdRef.current) return recordIdRef.current;
			const id =
				findSessionRecord(settingsAccess.getSavedSessions(), {
					by: "sessionId",
					id: sessionId,
				})?.recordId ?? newRecordId();
			setBinding(id);
			return id;
		},
		[settingsAccess, setBinding],
	);

	/** The store adopted a different record than we guessed: follow it. */
	const adoptRecordId = useCallback(
		(written: string | null) => {
			if (written) setBinding(written);
		},
		[setBinding],
	);

	const getRecordId = useCallback(() => recordIdRef.current ?? null, []);

	const rebindRecord = useCallback(
		(sessionId: string, kiroEngine?: "v2" | "v3") => {
			const recordId = recordIdRef.current;
			if (!recordId) return;
			sessionStore
				.rebindSession({ recordId, sessionId, kiroEngine })
				.catch((err) =>
					getLogger().error("[SessionHistory] Record rebind failed:", err),
				);
		},
		[sessionStore],
	);

	const resetRecordBinding = useCallback(() => {
		setBinding(null);
	}, [setBinding]);

	// State
	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
	const [localSessionIds, setLocalSessionIds] = useState<Set<string>>(
		new Set(),
	);

	// Cache reference (not state to avoid re-renders)
	const cacheRef = useRef<SessionCache | null>(null);
	const currentCwdRef = useRef<string | undefined>(undefined);

	/**
	 * Check if cache is valid.
	 */
	const isCacheValid = useCallback((cwd?: string): boolean => {
		if (!cacheRef.current) return false;

		// Check if cwd matches
		if (cacheRef.current.cwd !== cwd) return false;

		// Check if cache has expired
		const age = Date.now() - cacheRef.current.timestamp;
		return age < CACHE_EXPIRY_MS;
	}, []);

	/**
	 * Invalidate the cache.
	 */
	const invalidateCache = useCallback(() => {
		cacheRef.current = null;
	}, []);

	/**
	 * Fetch the session list for the chosen source.
	 *
	 * - **Local** (default): the canonical "your history" — EVERY agent's saved
	 *   sessions across ALL vaults. Drops the per-agent filter so a
	 *   plugin-created fork (and sessions from other agents) appears even on a
	 *   listing agent's tab — the motivating Session History Source Model fix.
	 *   The cwd "This vault only" filter does NOT apply to Local; it is the
	 *   whole local store. Each row carries its `agentId` for the badge and for
	 *   per-row action resolution. No agent call.
	 * - **Agent**: the agent's server-side `session/list` (e.g. Claude),
	 *   honoring the cwd filter, with local titles overlaid. Cached.
	 *
	 * An "agent" source falls back to Local when the agent cannot list — this
	 * mirrors `deriveSessionHistoryView`'s capability gate so the fetch and the
	 * resolved view never disagree.
	 */
	const fetchSessions = useCallback(
		async (source: SessionListSource, cwd?: string) => {
			const useLocal =
				source === "local" ||
				!historyCapabilities.capabilities.listsSessions;

			if (useLocal) {
				// Unified local store: every agent, every vault. No agentId or
				// cwd filter — Local is the user's whole history.
				const localSessions = settingsAccess.getSavedSessions();

				const sessionInfos: SessionInfo[] = localSessions.map((s) => ({
					sessionId: s.sessionId,
					cwd: s.cwd,
					title: s.title,
					updatedAt: s.updatedAt,
					agentId: s.agentId,
				}));

				setSessions(sessionInfos);
				setLocalSessionIds(
					new Set(localSessions.map((s) => s.sessionId)),
				);
				setNextCursor(undefined); // No pagination for local sessions
				setError(null);
				return;
			}

			// Not connected: no session/list (Connection-free reading, I260).
			// The modal serves the last-synced metadata cache in this state, so
			// asking the agent would only add a "Failed to fetch" error.
			if (session.state !== "ready") {
				setLocalSessionIds(
					new Set(
						settingsAccess
							.getSavedSessions(session.agentId, cwd)
							.map((s) => s.sessionId),
					),
				);
				setSessions([]);
				setNextCursor(undefined);
				setError(null);
				return;
			}

			// Check cache first
			if (isCacheValid(cwd)) {
				// Update localSessionIds even on cache hit
				const localSessions = settingsAccess.getSavedSessions(
					session.agentId,
					cwd,
				);
				setLocalSessionIds(
					new Set(localSessions.map((s) => s.sessionId)),
				);
				// Re-merge with local titles to pick up newly saved session titles
				const sessionsWithLocalTitles = overlayLocalTitles(
					cacheRef.current!.sessions,
					settingsAccess.getSavedSessions(),
					session.agentId,
				);
				setSessions(sessionsWithLocalTitles);
				setNextCursor(cacheRef.current!.nextCursor);
				setError(null);
				return;
			}

			setLoading(true);
			setError(null);
			currentCwdRef.current = cwd;

			try {
				const result: ListSessionsResult =
					await agentClient.listSessions(cwd);

				// Merge with local titles for better UX
				// (some agents return poor quality titles)
				const localSessions = settingsAccess.getSavedSessions(
					session.agentId,
					cwd,
				);
				const sessionsWithLocalTitles = overlayLocalTitles(
					result.sessions,
					settingsAccess.getSavedSessions(),
					session.agentId,
				);

				// Update state
				setSessions(sessionsWithLocalTitles);
				setLocalSessionIds(
					new Set(localSessions.map((s) => s.sessionId)),
				);
				setNextCursor(result.nextCursor);

				// Update cache (with merged titles)
				cacheRef.current = {
					sessions: sessionsWithLocalTitles,
					nextCursor: result.nextCursor,
					cwd,
					timestamp: Date.now(),
				};
			} catch (err) {
				const errorMessage = extractErrorMessage(err);
				setError(
					t("chat.history.failedFetch", { message: errorMessage }),
				);
				setSessions([]);
				setNextCursor(undefined);
			} finally {
				setLoading(false);
			}
		},
		[
			agentClient,
			historyCapabilities.capabilities.listsSessions,
			isCacheValid,
			settingsAccess,
			session.agentId,
			session.state,
		],
	);

	/**
	 * Load more sessions (pagination).
	 * Appends to existing sessions list.
	 */
	const loadMoreSessions = useCallback(async () => {
		// Guard: Check if there's more to load
		if (!nextCursor || !capabilities.listsSessions) {
			return;
		}

		setLoading(true);
		setError(null);

		try {
			const result: ListSessionsResult = await agentClient.listSessions(
				currentCwdRef.current,
				nextCursor,
			);

			// Merge with local titles for better UX
			// (some agents return poor quality titles)
			const localSessions = settingsAccess.getSavedSessions(
				session.agentId,
				currentCwdRef.current,
			);
			const sessionsWithLocalTitles = overlayLocalTitles(
				result.sessions,
				settingsAccess.getSavedSessions(),
				session.agentId,
			);

			// Append new sessions to existing list (use functional setState)
			setSessions((prev) => [...prev, ...sessionsWithLocalTitles]);
			setLocalSessionIds(new Set(localSessions.map((s) => s.sessionId)));
			setNextCursor(result.nextCursor);

			// Update cache with appended sessions (with merged titles)
			if (cacheRef.current) {
				cacheRef.current = {
					...cacheRef.current,
					sessions: [
						...cacheRef.current.sessions,
						...sessionsWithLocalTitles,
					],
					nextCursor: result.nextCursor,
					timestamp: Date.now(),
				};
			}
		} catch (err) {
			const errorMessage = extractErrorMessage(err);
			setError(
					t("chat.history.failedLoadMore", { message: errorMessage }),
				);
		} finally {
			setLoading(false);
		}
	}, [
		agentClient,
		capabilities.listsSessions,
		nextCursor,
		settingsAccess,
		session.agentId,
	]);

	/**
	 * Delete a session (local metadata + message file).
	 * Removes from both local state and persistent storage.
	 */
	const deleteSession = useCallback(
		async (sessionId: string) => {
			try {
				// Delete from persistent storage (metadata + message file). A
				// local row's agent id names exactly one record (I269).
				const record = findSessionRecord(settingsAccess.getSavedSessions(), {
					by: "sessionId",
					id: sessionId,
				});
				await settingsAccess.deleteSession(sessionId, record?.recordId);

				// Remove from local state
				setSessions((prev) =>
					prev.filter((s) => s.sessionId !== sessionId),
				);

				// Invalidate cache to ensure consistency
				invalidateCache();
			} catch (err) {
				const errorMessage = extractErrorMessage(err);
				setError(
					t("chat.history.failedDelete", { message: errorMessage }),
				);
				throw err; // Re-throw to allow caller to handle
			}
		},
		[settingsAccess, invalidateCache],
	);

	/**
	 * Update the title of a saved session.
	 * Updates both local state and persistent storage.
	 */
	const updateSessionTitle = useCallback(
		async (sessionId: string, newTitle: string, sessionCwd: string) => {
			// Read current title for potential rollback
			const savedSessions = settingsAccess.getSavedSessions();
			const existing = savedSessions.find(
				(s) => s.sessionId === sessionId,
			);
			const previousTitle = existing?.title;

			// Optimistic update
			setSessions((prev) =>
				prev.map((s) =>
					s.sessionId === sessionId ? { ...s, title: newTitle } : s,
				),
			);

			try {
				// Explicit user rename → route through the single writer so it
				// can't be clobbered by a concurrent turn-end save (Phase 4 §2c).
				// createIfMissing creates a local entry for a session that exists
				// only on the agent side, using sessionCwd.
				// The row's own record (I269); its agent and session id are
				// left as they are, even when this tab runs another agent.
				await sessionStore.renameSession({
					recordId: existing?.recordId ?? null,
					sessionId,
					agentId: session.agentId,
					cwd: sessionCwd,
					title: newTitle,
					createIfMissing: true,
				});

				invalidateCache();
			} catch (err) {
				// Rollback optimistic update
				setSessions((prev) =>
					prev.map((s) =>
						s.sessionId === sessionId
							? { ...s, title: previousTitle }
							: s,
					),
				);
				const errorMessage = extractErrorMessage(err);
				setError(
					t("chat.history.failedUpdateTitle", { message: errorMessage }),
				);
				throw err;
			}
		},
		[settingsAccess, session.agentId, invalidateCache, sessionStore],
	);

	/**
	 * Save session metadata locally.
	 * Called when the first message is sent in a new session.
	 */
	const saveSessionLocally = useCallback(
		async (sessionId: string, messageContent: string) => {
			if (!session.agentId) return;

			const title =
				messageContent.length > 50
					? messageContent.substring(0, 50) + "..."
					: messageContent;

			// First-message metadata → single writer (Phase 4 §2c). The title
			// is a fallback: recordFirstMessage preserves any existing AI title
			// or rename instead of overwriting it with the first-message text.
			adoptRecordId(
				await sessionStore.recordFirstMessage({
					recordId: bindRecordId(sessionId),
					sessionId,
					agentId: session.agentId,
					cwd: agentCwd,
					firstMessageTitle: title,
				}),
			);
		},
		[session.agentId, agentCwd, sessionStore, bindRecordId, adoptRecordId],
	);

	/**
	 * Save session messages locally.
	 * Called when a turn ends (agent response complete).
	 * Fire-and-forget (does not block UI).
	 *
	 * Also bumps the session's `updatedAt` metadata so that
	 * `getSavedSessions()` (sorted by updatedAt desc) reflects actual
	 * activity rather than just session-creation time (#257).
	 */
	const saveSessionMessages = useCallback(
		(
			sessionId: string,
			messages: import("../types/chat").ChatMessage[],
			contextNotes?: ContextNote[],
			suggestedTitle?: string | null,
		): Promise<void> => {
			if (!session.agentId || messages.length === 0)
				return Promise.resolve();

			// Persist message content + crystallized context. Returned so a
			// teardown flush (useDebouncedSessionSave.flushPending ->
			// ChatView.onClose) can AWAIT the write, so the final turn survives
			// a quit/reload (I193). The message FILE is an independent concern
			// from the savedSessions metadata array and not part of the title
			// race.
			// I269: the file and the record both use the tab's record id, so
			// a fallback's new agent session keeps writing the same chat.
			const recordId = bindRecordId(sessionId);
			const writePromise = settingsAccess.saveSessionMessages(
				recordId,
				session.agentId,
				messages,
				contextNotes,
			);

			// Upsert session metadata through the single serialized writer
			// (I114). The owner re-reads the latest snapshot inside its critical
			// section and consults the title-precedence resolver, so a
			// concurrent AI-title write is never clobbered by a stale read, and
			// a transcript-on-disk session is never orphaned from the history
			// list (I58). A carried `suggestedTitle` sets the AI title; omitting
			// it preserves the existing title.
			sessionStore
				.recordTurnSave({
					recordId,
					sessionId,
					agentId: session.agentId,
					cwd: agentCwd,
					messages,
					suggestedTitle: suggestedTitle ?? null,
					seedTitle: restoredAgentTitle ?? null,
					// D2: the engine this turn ran on (launched engine, I235).
					kiroEngine: session.kiroEngine,
				})
				.then((written) => {
					// The store adopted another record for this session (one
					// created elsewhere mid-turn): write the transcript under
					// its id too, so file and record agree from this turn on.
					if (written && written !== recordId && session.agentId) {
						void settingsAccess.saveSessionMessages(
							written,
							session.agentId,
							messages,
							contextNotes,
						);
					}
					adoptRecordId(written);
				})
				.catch((err) =>
					getLogger().error("[SessionHistory] Turn save refused:", err),
				);

			return writePromise;
		},
		[
			session.agentId,
			session.kiroEngine,
			agentCwd,
			settingsAccess,
			sessionStore,
			restoredAgentTitle,
			bindRecordId,
			adoptRecordId,
		],
	);

	/**
	 * Propagate the resolved AI-suggested title to the session-history record
	 * (I114). Routes through the single serialized writer so it cannot be
	 * clobbered by — and cannot clobber — a concurrent turn-end / debounced
	 * save. Replaces the racing `useTitleHistorySync` hook.
	 */
	const applySessionTitle = useCallback(
		(sessionId: string, suggestedTitle: string, sessionCwd: string) => {
			if (!session.agentId) return;
			sessionStore
				.applySuggestedTitle({
					recordId: bindRecordId(sessionId),
					sessionId,
					agentId: session.agentId,
					cwd: sessionCwd,
					suggestedTitle,
				})
				.then(adoptRecordId)
				.catch((err) =>
					getLogger().error("[SessionHistory] Title write refused:", err),
				);
		},
		[session.agentId, sessionStore, bindRecordId, adoptRecordId],
	);

	/**
	 * Load a session's persisted messages (passthrough to settings access).
	 * Used by the search engine to build its content index.
	 */
	const loadSessionMessages = useCallback(
		(sessionId: string) => settingsAccess.loadSessionMessages(sessionId),
		[settingsAccess],
	);

	/**
	 * Mirror the agent's server-session metadata into the local cache (Session
	 * History Source Model Decision 1, "Mirror cheap, import explicit" tenet).
	 *
	 * `session/list` returns metadata only — no transcripts — so this is a
	 * cheap, faithful one-shot mirror. Called on connect (agent ready) for a
	 * listing agent; the cache then powers the **disconnected** Agent view with
	 * a "synced N ago" affordance. Best-effort: a failed list leaves the prior
	 * cache intact (never presents an empty list as a fresh sync).
	 */
	const syncAgentSessionMetaCache = useCallback(async () => {
		if (!session.agentId || !capabilities.listsSessions) return;
		try {
			const result = await agentClient.listSessions();
			const agentId = session.agentId;
			const current = settingsAccess.getSnapshot().agentSessionMetaCache;
			await settingsAccess.updateSettings({
				agentSessionMetaCache: {
					...current,
					[agentId]: {
						sessions: result.sessions,
						syncedAt: new Date().toISOString(),
					},
				},
			});
		} catch {
			// Best-effort mirror — keep the last good cache on failure.
		}
	}, [agentClient, capabilities.listsSessions, session.agentId, settingsAccess]);

	return useMemo(
		() => ({
			sessions,
			loading,
			error,
			hasMore: nextCursor !== undefined,

			// Normalized capability record (Track B) — the resolver input.
			capabilities,
			historyCapabilities,
			// Capability flags
			canShowSessionHistory: true,
			canRestore: capabilities.restoresViaLoad || capabilities.restoresViaResume,
			canFork: capabilities.forks,
			canList: capabilities.listsSessions,
			isUsingLocalSessions: !capabilities.listsSessions,
			localSessionIds,

			// Methods
			fetchSessions,
			loadMoreSessions,
			getRecordId,
			rebindRecord,
			resetRecordBinding,
			deleteSession,
			updateSessionTitle,
			saveSessionLocally,
			saveSessionMessages,
			applySessionTitle,
			loadSessionMessages,
			invalidateCache,
			syncAgentSessionMetaCache,
		}),
		[
			sessions,
			loading,
			error,
			nextCursor,
			capabilities,
			historyCapabilities,
			capabilities.listsSessions,
			capabilities.restoresViaLoad,
			capabilities.restoresViaResume,
			capabilities.forks,
			localSessionIds,
			fetchSessions,
			loadMoreSessions,
			getRecordId,
			rebindRecord,
			resetRecordBinding,
			deleteSession,
			updateSessionTitle,
			saveSessionLocally,
			saveSessionMessages,
			applySessionTitle,
			loadSessionMessages,
			invalidateCache,
			syncAgentSessionMetaCache,
		],
	);
}

/** Whether two capability records match on every axis. */
function sameCapabilities(a: AgentCapabilities, b: AgentCapabilities): boolean {
	return (Object.keys(b) as (keyof AgentCapabilities)[]).every(
		(k) => a[k] === b[k],
	);
}
