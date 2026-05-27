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
		return `${this.plugin.app.vault.configDir}/plugins/agent-client/sessions`;
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
			savedAt: new Date().toISOString(),
		};

		const filePath = this.getSessionFilePath(sessionId);
		await this.plugin.app.vault.adapter.write(
			filePath,
			JSON.stringify(data, null, 2),
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

		if (!(await adapter.exists(filePath))) {
			return null;
		}

		try {
			const content = await adapter.read(filePath);
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
function isValidPerLeafTabState(
	value: unknown,
): value is PerLeafTabState {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	if (typeof v.leafId !== "string") return false;
	if (typeof v.activeTabId !== "string") return false;
	if (!Array.isArray(v.tabs)) return false;
	return v.tabs.every(isValidPersistedTabInfo);
}

/** Type guard: validates a `PersistedTabInfo` record loaded from disk. */
function isValidPersistedTabInfo(
	value: unknown,
): value is PersistedTabInfo {
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
