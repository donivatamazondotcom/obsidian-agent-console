/**
 * Session storage for persisting session metadata and message history.
 *
 * Handles:
 * - Session metadata CRUD (in plugin settings savedSessions array)
 * - Session message file I/O (sessions/{id}.json)
 */

import { Platform } from "obsidian";

import type { AgentClientPluginSettings } from "../plugin";
import type AgentClientPlugin from "../plugin";
import type { ChatMessage, MessageContent } from "../types/chat";
import type { ContextNote } from "../types/context";
import { sanitizeContextNotes } from "./context-validator";
import type { SavedSessionInfo } from "../types/session";
import type { PerLeafTabState, PersistedTabInfo } from "../types/tab";
import { convertWindowsPathToWsl } from "../utils/platform";
import { getLogger } from "../utils/logger";

// ============================================================================
// Types
// ============================================================================

/**
 * Serialized format for session message files.
 */
interface SessionMessagesFile {
	version: number;
	sessionId: string;
	agentId: string;
	messages: Array<{
		id: string;
		role: "user" | "assistant";
		content: MessageContent[];
		timestamp: string;
	}>;
	contextNotes?: ContextNote[];
	savedAt: string;
}

/**
 * Interface for settings access needed by SessionStorage.
 * Subset of SettingsService to avoid circular dependency.
 */
interface SessionStorageSettingsAccess {
	getSnapshot(): AgentClientPluginSettings;
	updateSettings(updates: Partial<AgentClientPluginSettings>): Promise<void>;
}

// ============================================================================
// Implementation
// ============================================================================

/** Maximum number of saved sessions to keep */
const MAX_SAVED_SESSIONS = 50;

export class SessionStorage {
	private plugin: AgentClientPlugin;
	private settingsAccess: SessionStorageSettingsAccess;

	/** Lock for session operations to prevent race conditions */
	private sessionLock: Promise<void> = Promise.resolve();

	/**
	 * Lock for tab-state operations to prevent race conditions.
	 *
	 * Separate from `sessionLock` because tab-state and session-metadata
	 * are independent concerns — serializing them together would create
	 * unnecessary contention (a tab reorder shouldn't block a session
	 * save and vice versa).
	 */
	private tabStateLock: Promise<void> = Promise.resolve();

	constructor(
		plugin: AgentClientPlugin,
		settingsAccess: SessionStorageSettingsAccess,
	) {
		this.plugin = plugin;
		this.settingsAccess = settingsAccess;
	}

	// ============================================================
	// Session Metadata Methods
	// ============================================================

	/**
	 * Save a session to local storage.
	 *
	 * Updates existing session if sessionId matches.
	 * Maintains max 50 sessions, removing oldest when exceeded.
	 */
	async saveSession(info: SavedSessionInfo): Promise<void> {
		this.sessionLock = this.sessionLock.then(async () => {
			// Convert Windows path to WSL path if in WSL mode
			let sessionInfo = info;
			const state = this.settingsAccess.getSnapshot();
			if (Platform.isWin && state.windowsWslMode && info.cwd) {
				sessionInfo = {
					...info,
					cwd: convertWindowsPathToWsl(info.cwd),
				};
			}

			const sessions = [...(state.savedSessions || [])];

			// Find existing session by sessionId
			const existingIndex = sessions.findIndex(
				(s) => s.sessionId === sessionInfo.sessionId,
			);

			if (existingIndex >= 0) {
				sessions[existingIndex] = sessionInfo;
			} else {
				sessions.unshift(sessionInfo);
				if (sessions.length > MAX_SAVED_SESSIONS) {
					sessions.pop();
				}
			}

			await this.settingsAccess.updateSettings({
				savedSessions: sessions,
			});
		});
		await this.sessionLock;
	}

	/**
	 * Get saved sessions, optionally filtered by agentId and/or cwd.
	 * Returns sessions sorted by updatedAt (newest first).
	 */
	getSavedSessions(agentId?: string, cwd?: string): SavedSessionInfo[] {
		const state = this.settingsAccess.getSnapshot();
		let sessions = state.savedSessions || [];

		if (agentId) {
			sessions = sessions.filter((s) => s.agentId === agentId);
		}
		if (cwd) {
			let filterCwd = cwd;
			if (Platform.isWin && state.windowsWslMode) {
				filterCwd = convertWindowsPathToWsl(cwd);
			}
			sessions = sessions.filter((s) => s.cwd === filterCwd);
		}

		return [...sessions].sort(
			(a, b) =>
				new Date(b.updatedAt).getTime() -
				new Date(a.updatedAt).getTime(),
		);
	}

	/**
	 * Delete a saved session by sessionId.
	 * Also deletes the associated message history file.
	 */
	async deleteSession(sessionId: string): Promise<void> {
		this.sessionLock = this.sessionLock.then(async () => {
			const state = this.settingsAccess.getSnapshot();
			const sessions = (state.savedSessions || []).filter(
				(s) => s.sessionId !== sessionId,
			);
			await this.settingsAccess.updateSettings({
				savedSessions: sessions,
			});
			await this.deleteSessionMessages(sessionId);
		});
		await this.sessionLock;
	}

	// ============================================================
	// Session Message History Methods
	// ============================================================

	private getSessionsDir(): string {
		return `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/sessions`;
	}

	/**
	 * One-time migration of session files from the legacy `agent-client`
	 * plugin dir into this plugin's own dir. See
	 * [[I68 Session storage dir hardcoded to old agent-client plugin id]].
	 *
	 * The fork historically wrote sessions into the upstream plugin's
	 * directory; getSessionsDir() now resolves to this.plugin.manifest.id,
	 * so the live `agent-client/sessions` files would otherwise be
	 * orphaned. Copies each legacy file into the new dir, preferring the
	 * NEWER file on id collisions — a stale `agent-console` copy from an
	 * earlier build must never clobber a live `agent-client` session, and
	 * a re-run must never clobber freshly-written sessions.
	 *
	 * Guarded by the `legacySessionsMigrated` settings flag; the
	 * newer-wins rule is a defense-in-depth second layer that keeps the
	 * copy idempotent even if the flag is lost. Failures are logged and
	 * leave the flag unset so the next load retries.
	 */
	async migrateLegacySessionsDir(): Promise<void> {
		if (this.settingsAccess.getSnapshot().legacySessionsMigrated) {
			return;
		}

		const adapter = this.plugin.app.vault.adapter;
		const legacyDir = `${this.plugin.app.vault.configDir}/plugins/agent-client/sessions`;
		const targetDir = this.getSessionsDir();

		try {
			// legacyDir === targetDir when the id already matches —
			// nothing to migrate, just record the flag.
			if (legacyDir !== targetDir && (await adapter.exists(legacyDir))) {
				await this.ensureSessionsDir();
				const { files } = await adapter.list(legacyDir);
				for (const srcPath of files) {
					if (!srcPath.endsWith(".json")) continue;
					const name = srcPath.split("/").pop();
					if (!name) continue;
					const destPath = `${targetDir}/${name}`;

					if (await adapter.exists(destPath)) {
						const [srcStat, destStat] = await Promise.all([
							adapter.stat(srcPath),
							adapter.stat(destPath),
						]);
						// Newer wins: keep the destination when it is
						// newer-or-equal (already migrated, or a fresher
						// write landed in the new dir).
						if (
							srcStat &&
							destStat &&
							destStat.mtime >= srcStat.mtime
						) {
							continue;
						}
					}

					await adapter.write(destPath, await adapter.read(srcPath));
				}
			}
		} catch (error) {
			getLogger().error(
				`[SessionStorage] Legacy session migration failed: ${error}`,
			);
			return; // Leave the flag unset so the next load retries.
		}

		await this.settingsAccess.updateSettings({
			legacySessionsMigrated: true,
		});
	}

	private async ensureSessionsDir(): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		const sessionsDir = this.getSessionsDir();
		if (!(await adapter.exists(sessionsDir))) {
			await adapter.mkdir(sessionsDir);
		}
	}

	private getSessionFilePath(sessionId: string): string {
		const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
		return `${this.getSessionsDir()}/${safeId}.json`;
	}

	/**
	 * Save message history for a session.
	 */
	async saveSessionMessages(
		sessionId: string,
		agentId: string,
		messages: ChatMessage[],
		contextNotes?: ContextNote[],
	): Promise<void> {
		await this.ensureSessionsDir();

		const serialized = messages.map((msg) => ({
			...msg,
			timestamp: msg.timestamp.toISOString(),
		}));

		const data = {
			version: 1,
			sessionId,
			agentId,
			messages: serialized,
			contextNotes: contextNotes ?? [],
			savedAt: new Date().toISOString(),
		};

		const filePath = this.getSessionFilePath(sessionId);
		const payload = JSON.stringify(data, null, 2);

		// Write durability (I72). The original code wrote once with no
		// try/catch, and every caller invokes saveSessionMessages via
		// `void`, so a rejected write was swallowed silently with no trace —
		// the most likely cause of the missing session files that surface as
		// blank restored tabs on reload. Retry once on a transient failure;
		// if the write still fails, surface the loss to the log (with the
		// sessionId) rather than swallow it. We do not rethrow: callers void
		// the promise, so rethrowing would only produce an unhandled
		// rejection — the logged error is the durable trace.
		const adapter = this.plugin.app.vault.adapter;
		const MAX_ATTEMPTS = 2;
		let lastError: unknown;
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			try {
				await adapter.write(filePath, payload);
				return;
			} catch (error) {
				lastError = error;
				getLogger().warn(
					`[SessionStorage] saveSessionMessages write failed for ${sessionId} (attempt ${attempt}/${MAX_ATTEMPTS}): ${error}`,
				);
			}
		}
		getLogger().error(
			`[SessionStorage] saveSessionMessages failed after ${MAX_ATTEMPTS} attempts for ${sessionId}; message history may be lost: ${String(lastError)}`,
		);
	}

	/**
	 * Load message history for a session.
	 * Returns null if file doesn't exist or on error.
	 */
	async loadSessionMessages(
		sessionId: string,
	): Promise<ChatMessage[] | null> {
		const filePath = this.getSessionFilePath(sessionId);
		const adapter = this.plugin.app.vault.adapter;

		// TP-I01: do NOT gate on adapter.exists(). At plugin startup exists()
		// can transiently report false for a present, readable session file;
		// gating on it latched a false "history not stored locally" (I72)
		// recovery banner for tabs whose history was intact. Read directly and
		// treat a thrown read as the genuine missing-history signal, retrying
		// once on a transient read failure (mirrors the saveSessionMessages
		// write-durability retry). Never a fixed delay — a sleep is not a
		// signal.
		let content: string | null = null;
		const MAX_ATTEMPTS = 2;
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			try {
				content = await adapter.read(filePath);
				break;
			} catch (error) {
				if (attempt >= MAX_ATTEMPTS) {
					// Genuine miss / unreadable — the I72 recovery path.
					// Logged (this path was previously silent) so a real miss
					// leaves a trace with the sessionId.
					getLogger().debug(
						`[SessionStorage] No readable session file for ${sessionId}: ${String(error)}`,
					);
					return null;
				}
			}
		}
		if (content === null) {
			return null;
		}

		try {
			const data = JSON.parse(content) as SessionMessagesFile;

			if (
				typeof data.version !== "number" ||
				!Array.isArray(data.messages)
			) {
				getLogger().debug(
					`[SessionStorage] Invalid session file structure: ${filePath}`,
				);
				return null;
			}

			if (data.version !== 1) {
				getLogger().debug(
					`[SessionStorage] Unknown session file version: ${data.version}`,
				);
				return null;
			}

			return data.messages.map((msg) => ({
				...msg,
				timestamp: new Date(msg.timestamp),
			}));
		} catch (error) {
			getLogger().error(
				`[SessionStorage] Failed to load session messages: ${error}`,
			);
			return null;
		}
	}

	/**
	 * Load crystallized context notes for a session from the same file.
	 * Returns null if the file does not exist or has no contextNotes.
	 */
	async loadSessionContextNotes(
		sessionId: string,
	): Promise<ContextNote[] | null> {
		const filePath = this.getSessionFilePath(sessionId);
		const adapter = this.plugin.app.vault.adapter;
		// TP-I02: do NOT gate on adapter.exists() — same startup false-negative
		// as TP-I01 in loadSessionMessages. Gating here could silently drop
		// restored context-strip notes for a tab whose session file is intact.
		// Read directly; a thrown read on the final attempt is the genuine
		// missing-file signal. Retry once, no fixed delay (a sleep is not a
		// signal).
		let content: string | null = null;
		const MAX_ATTEMPTS = 2;
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			try {
				content = await adapter.read(filePath);
				break;
			} catch {
				if (attempt >= MAX_ATTEMPTS) return null;
			}
		}
		if (content === null) return null;
		try {
			const data = JSON.parse(content) as SessionMessagesFile;
			if (!Array.isArray(data.contextNotes)) return null;
			const { notes, dropped } = sanitizeContextNotes(data.contextNotes);
			if (dropped.length > 0) {
				getLogger().warn(
					`[SessionStorage] Dropped ${dropped.length} corrupt context note(s) for ${sessionId}: ${JSON.stringify(dropped)}`,
				);
			}
			return notes;
		} catch {
			return null;
		}
	}

	/**
	 * Delete message history file for a session.
	 * Silently succeeds if file doesn't exist.
	 */
	async deleteSessionMessages(sessionId: string): Promise<void> {
		const filePath = this.getSessionFilePath(sessionId);
		const adapter = this.plugin.app.vault.adapter;

		if (await adapter.exists(filePath)) {
			await adapter.remove(filePath);
		}
	}

	// ============================================================
	// Tab State Methods (per spec § Persistence — Save / Restore)
	// ============================================================

	/**
	 * Save per-leaf tab state to data.json.
	 *
	 * Wholesale replaces the current tab-state. Per spec § Save:
	 * serializes `{ leafId, tabs: PersistedTabInfo[], activeTabId }[]`
	 * for restoration across Obsidian restarts.
	 *
	 * Does not validate the input — callers are responsible for shape.
	 * Validation happens on load (see `loadTabState`).
	 *
	 * Serialized to data.json via the SettingsAccess facade, alongside
	 * `savedSessions`. Per-session message history is stored separately
	 * in `sessions/{id}.json` and is not affected by this method.
	 *
	 * @param perLeafStates - Per-leaf states; may be empty array
	 */
	async saveTabState(perLeafStates: PerLeafTabState[]): Promise<void> {
		this.tabStateLock = this.tabStateLock.then(async () => {
			await this.settingsAccess.updateSettings({
				perLeafTabStates: perLeafStates,
			});
		});
		await this.tabStateLock;
	}

	/**
	 * Load per-leaf tab state from data.json.
	 *
	 * Corruption-tolerant per spec § Corruption handling:
	 *   - Returns null when the field is missing (undefined or null)
	 *   - Returns null when the field is not an array
	 *   - Returns null when any record is missing required fields, has
	 *     wrong field types, or contains a malformed nested tab record
	 *   - Does NOT throw — caller handles null
	 *   - Does NOT delete the corrupted data on disk. Preservation is
	 *     the user's recovery path (the corruption-recovery modal can
	 *     surface the raw state for manual inspection); call
	 *     `discardTabState()` explicitly to clear it.
	 *
	 * Read path is read-only on the snapshot — does not invoke
	 * updateSettings, so no side-effect persistence happens here.
	 *
	 * @returns Array of per-leaf states, or null if none / corrupted
	 */
	async loadTabState(): Promise<PerLeafTabState[] | null> {
		const state = this.settingsAccess.getSnapshot();
		const raw = state.perLeafTabStates;

		if (raw === undefined || raw === null) {
			return null;
		}
		if (!Array.isArray(raw)) {
			return null;
		}
		if (!raw.every(isValidPerLeafTabState)) {
			return null;
		}
		return raw;
	}

	/**
	 * Clear the tab-state portion of data.json.
	 *
	 * Per spec § Corruption handling: leaves session-message storage
	 * and other settings (savedSessions, defaultAgentId, etc.) untouched.
	 *
	 * Used by:
	 *   - The corruption-recovery modal's "Discard saved state" action
	 *   - The "Restore tabs on startup" setting when the user toggles
	 *     it OFF after previously saving state
	 *
	 * Sets `perLeafTabStates` to undefined; on next `saveSettings()`
	 * the field is omitted from data.json (JSON.stringify drops
	 * undefined values), so disk and memory converge to "no saved
	 * tab state" — matching the U42 first-launch semantics.
	 */
	async discardTabState(): Promise<void> {
		this.tabStateLock = this.tabStateLock.then(async () => {
			await this.settingsAccess.updateSettings({
				perLeafTabStates: undefined,
			});
		});
		await this.tabStateLock;
	}

	/**
	 * Save per-leaf tab state atomically — replaces this leaf's slice
	 * in `perLeafTabStates` while preserving other leaves' slices.
	 *
	 * Read-modify-write under `tabStateLock` to prevent torn writes
	 * when multiple leaves save concurrently. The lock guarantees the
	 * read-merge-write sequence sees a consistent snapshot.
	 *
	 * Used by `useTabPersistence` (Slice 5) — each ChatView leaf saves
	 * its own slice on tab-state changes; this method ensures leaves
	 * don't clobber each other's state when they save in parallel.
	 *
	 * @param leafId - Leaf identifier
	 * @param leafState - The leaf's full PerLeafTabState
	 */
	async saveTabStateForLeaf(
		leafId: string,
		leafState: PerLeafTabState,
	): Promise<void> {
		this.tabStateLock = this.tabStateLock.then(async () => {
			const all =
				this.settingsAccess.getSnapshot().perLeafTabStates ?? [];
			const filtered = all.filter((s) => s.leafId !== leafId);
			const next = [...filtered, leafState];
			await this.settingsAccess.updateSettings({
				perLeafTabStates: next,
			});
		});
		await this.tabStateLock;
	}

	/**
	 * Convenience wrapper: load just this leaf's PerLeafTabState.
	 *
	 * Reuses `loadTabState`'s corruption-tolerant logic — if the
	 * entire persisted blob is corrupted (returns null), this method
	 * also returns null. Otherwise it returns this leaf's slice if
	 * present, or null if no entry matches the requested `leafId`.
	 *
	 * @param leafId - Leaf identifier
	 * @returns The leaf's state, or null if no state / corrupted / not present
	 */
	async loadTabStateForLeaf(leafId: string): Promise<PerLeafTabState | null> {
		const all = await this.loadTabState();
		if (all === null) return null;
		return all.find((s) => s.leafId === leafId) ?? null;
	}
}

// ============================================================================
// Helpers (type guards for tab-state validation)
// ============================================================================

/**
 * Type guard: validates a `PerLeafTabState` record loaded from disk.
 *
 * Hand-rolled per the existing service convention (see
 * `loadSessionMessages` schema validation). Does not introduce a
 * runtime validator dependency — keeping the validation surface small
 * is more important than completeness for the v1 corruption budget.
 */
function isValidPerLeafTabState(value: unknown): value is PerLeafTabState {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	if (typeof v.leafId !== "string") return false;
	if (typeof v.activeTabId !== "string") return false;
	if (!Array.isArray(v.tabs)) return false;
	return v.tabs.every(isValidPersistedTabInfo);
}

/** Type guard: validates a `PersistedTabInfo` record loaded from disk. */
function isValidPersistedTabInfo(value: unknown): value is PersistedTabInfo {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	if (typeof v.tabId !== "string") return false;
	if (typeof v.agentId !== "string") return false;
	if (typeof v.label !== "string") return false;
	// sessionId is `string | null` (explicit null preserved per U33).
	if (v.sessionId !== null && typeof v.sessionId !== "string") return false;
	if (typeof v.tabOrder !== "number") return false;
	if (typeof v.scrollPosition !== "number") return false;
	return true;
}
