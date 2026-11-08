import {
	NO_AGENT_CAPABILITIES,
	type AgentCapabilities,
	type KiroEngineFallback,
	type SessionResult,
} from "../types/session";
import {
	decideEngineRestore,
	type EngineChangeReason,
	type SessionEngine,
} from "../resolvers/session-engine";
import { decideLoadReplay } from "../resolvers/load-replay";
import type { RestoreFailureKind } from "../resolvers/restore-failure";
import { classifyLoadError } from "../acp/load-error";

/**
 * `fallbackReason` on a failure says why the session couldn't be reopened
 * when the reason is known (D2: `"engine-changed"`). Absent → generic.
 * `failure` says what kind of failure it was (I282), so the owner can tell a
 * session the agent doesn't have from an agent it couldn't reach.
 */
export type SessionAcquisitionResult =
	| { ok: true; sessionId: string }
	| {
			ok: false;
			error: Error;
			fallbackReason?: EngineChangeReason;
			failure?: RestoreFailureKind;
	  };

export interface LoadExistingSessionFlowArgs {
	sessionId: string;
	cwd: string;
	/**
	 * Whether local history is already displayed (seeded on mount). When
	 * true, the agent's `session/update` replay is suppressed so it does
	 * not duplicate the visible history; when false (type-before-restore
	 * race) the replay is allowed through as the sole source. (I43 #12)
	 */
	haveLocalHistory: boolean;
	/**
	 * The tab is bound to a local history record (I269). Without one, opening
	 * the row is the import, so a load that replays nothing is empty (I282).
	 * Default true (unchanged I264 behavior).
	 */
	hasLocalRecord?: boolean;
	loadSession: (sessionId: string, cwd: string) => Promise<SessionResult>;
	onLoaded: (result: SessionResult) => void;
	setIgnoreUpdates: (ignore: boolean) => void;
}

/**
 * Resume an existing session on first-keystroke reconnect (I44), with
 * conditional replay suppression (I43 Decision #12). Pure orchestration —
 * all I/O is injected so it is unit-testable without rendering ChatPanel.
 *
 * Mirrors the canonical `useSessionHistory.restoreSession` ignore-updates
 * pattern: suppress before `loadSession`, release in `finally`.
 */
export async function loadExistingSessionFlow(
	args: LoadExistingSessionFlowArgs,
): Promise<SessionAcquisitionResult> {
	const { sessionId, cwd, haveLocalHistory, loadSession, onLoaded, setIgnoreUpdates } =
		args;
	const hasLocalRecord = args.hasLocalRecord ?? true;
	if (haveLocalHistory) setIgnoreUpdates(true);
	try {
		const result = await loadSession(sessionId, cwd);
		// I264: Kiro V3 "loads" an id it never had as an empty session. With a
		// transcript on screen, no replay means the agent doesn't have this
		// chat: fail, so the owner starts a new session with the transcript.
		const replay = decideLoadReplay({
			replayedConversationUpdates: result.replayedConversationUpdates,
			expectsConversation: haveLocalHistory || !hasLocalRecord,
		});
		if (replay.kind === "empty") {
			return {
				ok: false,
				failure: "empty",
				error: new Error(
					`Session ${sessionId} loaded with no conversation; the agent doesn't have it`,
				),
			};
		}
		onLoaded(result);
		return { ok: true, sessionId: result.sessionId };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err : new Error(String(err)),
			failure: classifyLoadError(err),
		};
	} finally {
		if (haveLocalHistory) setIgnoreUpdates(false);
	}
}

/**
 * The slice of the ACP client a reconnect needs (I209). `AcpClient` satisfies
 * it structurally; tests fake it. `loadSession` / `resumeSession` throw while
 * the client is not initialized (`requireConnection()`).
 */
export interface ReconnectClientPort {
	isInitialized: () => boolean;
	getInitializeResult: () => {
		capabilities: AgentCapabilities;
		/** Engine the process was launched with (I235). */
		kiroEngine?: SessionEngine;
		/** Why it runs V2 instead of the Default V3 (I302). */
		kiroEngineFallback?: KiroEngineFallback;
	} | null;
	loadSession: (sessionId: string, cwd: string) => Promise<SessionResult>;
	resumeSession: (sessionId: string, cwd: string) => Promise<SessionResult>;
}

export interface ReconnectExistingSessionArgs {
	sessionId: string;
	cwd: string;
	client: ReconnectClientPort;
	/**
	 * Spawn and initialize the agent with the tab's config (the same builder
	 * eager initialize uses). Called only when the client is not initialized.
	 */
	initialize: () => Promise<void>;
	/**
	 * Whether a transcript is on screen right now. Read at load time, NOT from
	 * a mount snapshot: a tab that started fresh has no restored messages but
	 * has a transcript by the time it is released (I209).
	 */
	haveLocalHistory: () => boolean;
	/** I282: the tab is bound to a local history record (I269). */
	hasLocalRecord?: () => boolean;
	onLoaded: (result: SessionResult) => void;
	setIgnoreUpdates: (ignore: boolean) => void;
	/**
	 * Runs first, before any launch or load. ChatPanel clears an earlier
	 * failure here, as `createSession` does: a retry after a failed fallback
	 * starts with this load (I280), so the tab must not sit "connecting"
	 * under the old "Session Creation Failed" banner.
	 */
	onAttemptStart?: () => void;
	/** A resume attempt threw; the flow falls back to load. Logging only. */
	onResumeError?: (error: unknown) => void;
	/**
	 * Engine the chat last ran on, from `resolveStoredSessionEngine` (D2).
	 * Undefined → unknown (old data), which loads as before.
	 */
	storedEngine?: SessionEngine;
}

/**
 * Reconnect a kept session id — a released tab or a restored tab — when the
 * agent process may not be running (I209 § 3).
 *
 * 1. Initialize first when the client is disconnected. Loading on a
 *    disconnected client throws, which used to fall through to
 *    new-plus-transcript and show the lossy notice for a session the agent
 *    still had.
 * 2. With a transcript on screen and `session/resume` advertised, resume (no
 *    replay to suppress). A failed resume falls back to load.
 * 3. Otherwise load, suppressing the replay when a transcript is on screen
 *    (with none, the replay is the only source). A load that replays nothing
 *    while a transcript is on screen counts as failed (I264).
 *
 * Never throws. `{ ok: false }` tells the lazy owner to fall back to a new
 * session with the transcript as context. Capability is read from the
 * normalized record, never the agent id.
 */
export async function reconnectExistingSession(
	args: ReconnectExistingSessionArgs,
): Promise<SessionAcquisitionResult> {
	const { sessionId, cwd, client } = args;
	args.onAttemptStart?.();
	if (!client.isInitialized()) {
		try {
			await args.initialize();
		} catch (err) {
			return {
				ok: false,
				error: err instanceof Error ? err : new Error(String(err)),
				failure: "initialize",
			};
		}
	}
	const init = client.getInitializeResult();
	// D2: the running engine is known now. A V3 chat on V2 starts fresh
	// without sending its id (V2 answers `Internal error`).
	const engine = decideEngineRestore({
		stored: args.storedEngine,
		running: init?.kiroEngine,
		runningFallback: init?.kiroEngineFallback,
	});
	if (engine.kind === "start-fresh") {
		return {
			ok: false,
			error: new Error(
				`Session ran on Kiro ${engine.from}; this agent now runs ${engine.to}`,
			),
			fallbackReason: engine.reason,
			failure: engine.reason,
		};
	}
	const capabilities = init?.capabilities ?? NO_AGENT_CAPABILITIES;
	const haveLocalHistory = args.haveLocalHistory();

	if (haveLocalHistory && capabilities.restoresViaResume) {
		try {
			const result = await client.resumeSession(sessionId, cwd);
			args.onLoaded(result);
			return { ok: true, sessionId: result.sessionId };
		} catch (err) {
			args.onResumeError?.(err);
		}
	}

	return loadExistingSessionFlow({
		sessionId,
		cwd,
		haveLocalHistory,
		hasLocalRecord: args.hasLocalRecord?.() ?? true,
		loadSession: (id, c) => client.loadSession(id, c),
		onLoaded: args.onLoaded,
		setIgnoreUpdates: args.setIgnoreUpdates,
	});
}
