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
import { findSessionRecord, validateSavedSession } from "./session-record";
import {
	parseMaxSavedSessions,
	selectEvictions,
	selectUnusedSessionFiles,
	sessionFileStem,
	tabSessionIds,
	UNUSED_FILE_MIN_AGE_MS,
	type SavedSessionsCap,
	type SessionFileInfo,
} from "../resolvers/session-retention";

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

/** Optional hooks for SessionStorage side effects the UI owns. */
export interface SessionStorageOptions {
	/**
	 * Called the first time in this plugin load that saving a chat evicts an
	 * older one (I202), with the cap in force. Later evictions are quiet.
	 */
	onFirstEviction?: (cap: number) => void;
	/**
	 * Session ids of chats open in a tab right now, plus recently closed
	 * tabs that can still be reopened. Protected from eviction and cleanup
	 * whether or not Restore tabs on startup saves tab state (I202 review).
	 */
	getLiveSessionIds?: () => Iterable<string>;
}

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

	private options: SessionStorageOptions;

	/** I202: the eviction notice shows at most once per plugin load. */
	private evictionReported = false;

	constructor(
		plugin: AgentClientPlugin,
		settingsAccess: SessionStorageSettingsAccess,
		options: SessionStorageOptions = {},
	) {
		this.plugin = plugin;
		this.settingsAccess = settingsAccess;
		this.options = options;
	}

	// ============================================================
	// Session Metadata Methods
	// ============================================================

	/**
	 * Run `fn` after every earlier locked operation. The caller still sees
	 * `fn`'s error, but the chain itself never stays rejected, so one failed
	 * operation can't silently skip every later save (I202 review).
	 */
	private runLocked<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.sessionLock.then(fn);
		this.sessionLock = run.then(
			() => undefined,
			(error: unknown) => {
				getLogger().warn(
					`[SessionStorage] Locked session operation failed: ${String(error)}`,
				);
			},
		);
		return run;
	}

	/** Saved tab ids plus live and recently closed tab ids. */
	private protectedSessionIds(state: AgentClientPluginSettings): Set<string> {
		const ids = tabSessionIds(state.perLeafTabStates);
		for (const id of this.options.getLiveSessionIds?.() ?? []) ids.add(id);
		return ids;
	}

	/**
	 * Save a session to local storage.
	 *
	 * Updates existing session if sessionId matches. When a new session
	 * pushes the list over Max saved chats, the least recently updated chats
	 * that no persisted tab uses are removed and their transcripts moved to
	 * the trash in the same locked write (I202). This method and
	 * `applyMaxSavedSessions` are the only evictors.
	 */
	async saveSession(info: SavedSessionInfo): Promise<void> {
		await this.runLocked(async () => {
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

			// Upsert by the plugin-owned record id (I269); the agent session id
			// is an attribute a fallback changes.
			const existingIndex = sessions.findIndex(
				(s) => s.recordId === sessionInfo.recordId,
			);
			// Write-edge validation (I269): the incoming record against the
			// others. Refused loudly so the caller's failure path runs; never
			// coerced.
			const violations = validateSavedSession(
				sessionInfo,
				sessions.filter((_, i) => i !== existingIndex),
			);
			if (violations.length > 0) {
				getLogger().warn(
					`[SessionStorage] Refused saved-session write: ${violations.join(", ")}`,
					sessionInfo,
				);
				throw new Error(
					`Saved session write refused: ${violations.join(", ")}`,
				);
			}

			if (existingIndex >= 0) {
				sessions[existingIndex] = sessionInfo;
				await this.settingsAccess.updateSettings({
					savedSessions: sessions,
				});
				return;
			}

			sessions.unshift(sessionInfo);
			const cap = this.readCap(state);
			const protectedIds = this.protectedSessionIds(state);
			protectedIds.add(sessionInfo.sessionId);
			const { kept, evicted } = selectEvictions(
				sessions,
				cap,
				protectedIds,
			);
			await this.settingsAccess.updateSettings({
				savedSessions: kept,
			});
			await this.trashEvicted(evicted);
			if (evicted.length > 0 && cap !== null && !this.evictionReported) {
				this.evictionReported = true;
				this.options.onFirstEviction?.(cap);
			}
		});
	}

	/**
	 * How many saved chats `applyMaxSavedSessions(cap)` would move to the
	 * trash right now. Read-only; feeds the confirm dialog.
	 */
	countEvictionsForCap(cap: SavedSessionsCap): number {
		if (!this.isOfferedCap(cap)) return 0;
		const state = this.settingsAccess.getSnapshot();
		return selectEvictions(
			state.savedSessions || [],
			cap,
			this.protectedSessionIds(state),
		).evicted.length;
	}

	/**
	 * Set Max saved chats and trim the list to it in one locked write. Chats
	 * open in a tab are kept even if that leaves the list over the cap.
	 *
	 * `confirmedCount` is the number the user agreed to in the dialog. If a
	 * chat was saved while the dialog was open and more would now go, nothing
	 * changes and this returns false so the caller can ask again.
	 */
	async applyMaxSavedSessions(
		cap: SavedSessionsCap,
		confirmedCount = 0,
	): Promise<boolean> {
		if (!this.isOfferedCap(cap)) {
			getLogger().warn(
				`[SessionStorage] Refusing Max saved chats ${String(cap)}: not an offered value`,
			);
			return false;
		}
		return this.runLocked(async () => {
			const state = this.settingsAccess.getSnapshot();
			const { kept, evicted } = selectEvictions(
				state.savedSessions || [],
				cap,
				this.protectedSessionIds(state),
			);
			if (evicted.length > confirmedCount) return false;
			await this.settingsAccess.updateSettings({
				maxSavedSessions: cap,
				savedSessions: kept,
			});
			await this.trashEvicted(evicted);
			return true;
		});
	}

	/**
	 * Transcript files no saved chat or open tab refers to, unchanged
	 * for at least a day (I202 cleanup command). Read-only.
	 */
	async findUnusedSessionFiles(
		now: number = Date.now(),
	): Promise<SessionFileInfo[]> {
		const adapter = this.plugin.app.vault.adapter;
		const dir = this.getSessionsDir();
		if (!(await adapter.exists(dir))) return [];
		const { files } = await adapter.list(dir);
		const infos: SessionFileInfo[] = [];
		for (const filePath of files) {
			const name = filePath.slice(filePath.lastIndexOf("/") + 1);
			if (!name.endsWith(".json")) continue;
			const stat = await adapter.stat(filePath);
			if (!stat || stat.type !== "file") continue;
			infos.push({
				stem: name.slice(0, -".json".length),
				mtime: stat.mtime,
				size: stat.size,
			});
		}
		return selectUnusedSessionFiles({
			files: infos,
			referencedStems: this.referencedStems(),
			now,
			minAgeMs: UNUSED_FILE_MIN_AGE_MS,
		});
	}

	/**
	 * Move every unused transcript file to the trash. Re-checks references
	 * inside the session lock, so a chat saved since the user confirmed is
	 * never touched.
	 */
	async trashUnusedSessionFiles(
		now: number = Date.now(),
	): Promise<{ count: number; bytes: number }> {
		let result = { count: 0, bytes: 0 };
		await this.runLocked(async () => {
			const unused = await this.findUnusedSessionFiles(now);
			for (const file of unused) {
				const path = `${this.getSessionsDir()}/${file.stem}.json`;
				if (await this.trashPath(path)) {
					result = {
						count: result.count + 1,
						bytes: result.bytes + file.size,
					};
				}
			}
		});
		return result;
	}

	/**
	 * The cap in force. The settings normalizer is the trust boundary that
	 * restricts the value to the dropdown's options; here any positive whole
	 * number is honored, and a missing value means the default.
	 */
	private readCap(state: AgentClientPluginSettings): SavedSessionsCap {
		const raw: unknown = state.maxSavedSessions;
		if (raw === null) return null;
		if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
			return raw;
		}
		return parseMaxSavedSessions(undefined).cap;
	}

	/**
	 * Trust boundary for a cap from the UI: only the dropdown's values (or
	 * Unlimited). A stray 0 or NaN would otherwise trash nearly every chat.
	 */
	private isOfferedCap(cap: SavedSessionsCap): boolean {
		return parseMaxSavedSessions(cap).valid;
	}

	private referencedStems(): Set<string> {
		const state = this.settingsAccess.getSnapshot();
		const stems = new Set<string>();
		// I269: a record's transcript is named by its record id. The session
		// id stems stay referenced too (legacy and agent-only files).
		for (const s of state.savedSessions || []) {
			stems.add(sessionFileStem(s.recordId));
			stems.add(sessionFileStem(s.sessionId));
		}
		for (const id of this.protectedSessionIds(state)) {
			stems.add(sessionFileStem(id));
		}
		for (const leaf of state.perLeafTabStates || []) {
			for (const tab of leaf.tabs || []) {
				if (tab.recordId) stems.add(sessionFileStem(tab.recordId));
			}
		}
		return stems;
	}

	private async trashEvicted(evicted: SavedSessionInfo[]): Promise<void> {
		for (const record of evicted) {
			// I269: the file is named by the record id.
			await this.trashSessionFile(record.recordId);
		}
	}

	/**
	 * Move a session's transcript to the trash: the system trash, or the
	 * vault's `.trash` folder when the system trash is off. A missing file is
	 * fine. A failure is logged and the file stays, so the cleanup command
	 * can find it later. The one place transcript files are removed (I202).
	 */
	private async trashSessionFile(sessionId: string): Promise<void> {
		await this.trashPath(this.getSessionFilePath(sessionId));
	}

	private async trashPath(filePath: string): Promise<boolean> {
		const adapter = this.plugin.app.vault.adapter;
		try {
			if (!(await adapter.exists(filePath))) return false;
			if (!(await adapter.trashSystem(filePath))) {
				await adapter.trashLocal(filePath);
			}
			return true;
		} catch (error) {
			getLogger().warn(
				`[SessionStorage] Could not move ${filePath} to the trash: ${String(error)}`,
			);
			return false;
		}
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
	 * Delete a saved session and move its message file to the trash (I202).
	 * I269: the file is named by the record id. `sessionId` is the agent id a
	 * history row shows; `recordId`, when the caller holds one, wins. With no
	 * record, the legacy `sessions/{sessionId}.json` goes only if no record
	 * claims that id.
	 */
	async deleteSession(
		sessionId: string,
		recordId?: string | null,
	): Promise<void> {
		await this.runLocked(async () => {
			const state = this.settingsAccess.getSnapshot();
			const all = state.savedSessions || [];
			const record =
				(recordId
					? findSessionRecord(all, { by: "recordId", id: recordId })
					: undefined) ??
				findSessionRecord(all, { by: "sessionId", id: sessionId });
			const fileId = record
				? record.recordId
				: this.messageFileId(sessionId, recordId);
			await this.settingsAccess.updateSettings({
				savedSessions: all.filter((s) => s !== record),
			});
			if (fileId) await this.trashSessionFile(fileId);
		});
	}

	/**
	 * Which message file holds a chat's transcript (I269). A caller holding a
	 * record id uses it, unless no record claims it any more (an adopt folded
	 * it into the record that holds the session), in which case the session
	 * decides. Otherwise the agent id is matched against records' `sessionId`
	 * only, and the record's id names the file. With no record, the legacy
	 * file named after the id is used only when no record claims that id as
	 * its record id (that file belongs to the claiming record).
	 */
	private messageFileId(
		sessionId: string,
		recordId?: string | null,
	): string | null {
		const all = this.settingsAccess.getSnapshot()?.savedSessions || [];
		if (recordId) {
			// A record id nothing claims any more (its file was folded into
			// the record that holds the session, I269 adopt) resolves through
			// the session; otherwise it names its own file.
			if (findSessionRecord(all, { by: "recordId", id: recordId })) {
				return recordId;
			}
			return (
				findSessionRecord(all, { by: "sessionId", id: sessionId })
					?.recordId ?? recordId
			);
		}
		const bySession = findSessionRecord(all, {
			by: "sessionId",
			id: sessionId,
		});
		if (bySession) return bySession.recordId;
		if (findSessionRecord(all, { by: "recordId", id: sessionId })) {
			return null;
		}
		return sessionId;
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
		return `${this.getSessionsDir()}/${sessionFileStem(sessionId)}.json`;
	}

	/**
	 * Save message history for a session.
	 */
	/** `sessionId` here is the record id that names the file (I269). */
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
		recordId?: string | null,
	): Promise<ChatMessage[] | null> {
		const fileId = this.messageFileId(sessionId, recordId);
		if (!fileId) return null;
		const filePath = this.getSessionFilePath(fileId);
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
		recordId?: string | null,
	): Promise<ContextNote[] | null> {
		const fileId = this.messageFileId(sessionId, recordId);
		if (!fileId) return null;
		const filePath = this.getSessionFilePath(fileId);
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

	/**
	 * Remove a single leaf's slice from `perLeafTabStates`, preserving the
	 * others. No-op when the leaf isn't present or no state is saved.
	 *
	 * Used by the reopen-restore path ([[ACP Restore Tabs on View Reopen]]):
	 * when a fresh leaf adopts a recently-closed snapshot, the old leafId's
	 * entry is an orphan no future leaf will ever match. Pruning it on adopt
	 * prevents unbounded `data.json` growth across reopens. Read-modify-write
	 * under `tabStateLock` so it cannot clobber a concurrent leaf save.
	 *
	 * @param leafId - Leaf identifier whose slice to remove
	 */
	async removeTabStateForLeaf(leafId: string): Promise<void> {
		this.tabStateLock = this.tabStateLock.then(async () => {
			const all =
				this.settingsAccess.getSnapshot().perLeafTabStates;
			if (!Array.isArray(all)) return;
			const next = all.filter((s) => s.leafId !== leafId);
			if (next.length === all.length) return; // nothing removed
			await this.settingsAccess.updateSettings({
				perLeafTabStates: next,
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
	// workingDirectory is optional (back-compat); when present must be string.
	if (v.workingDirectory !== undefined && typeof v.workingDirectory !== "string") return false;
	// recordId is optional (I269; absent before it); when present, a string.
	if (v.recordId !== undefined && typeof v.recordId !== "string") return false;
	return true;
}
