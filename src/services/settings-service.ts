/**
 * Settings Store Adapter
 *
 * Reactive settings store implementing ISettingAccess port.
 * Manages plugin settings state with observer pattern for React integration
 * via useSyncExternalStore, and handles persistence to Obsidian's data.json.
 */

import type { AgentClientPluginSettings } from "../plugin";
import type AgentClientPlugin from "../plugin";
import { updateDebugMode } from "../utils/logger";
import type { ChatMessage } from "../types/chat";
import type { SavedSessionInfo } from "../types/session";
import type { PerLeafTabState } from "../types/tab";
import { SessionStorage } from "./session-storage";
import type { ContextNote } from "../types/context";

// ============================================================================
// Port Types (from settings-access.port.ts)
// ============================================================================

/**
 * Interface for accessing and managing plugin settings.
 *
 * Provides reactive access to settings with subscription support
 * for detecting changes (e.g., for React components using useSyncExternalStore).
 *
 * This port will be implemented by adapters that handle the actual
 * storage mechanism (SettingsService, localStorage, etc.).
 */
export interface ISettingsAccess {
	/**
	 * Get the current settings snapshot.
	 *
	 * Used by React's useSyncExternalStore to read current state.
	 * Should return the settings object immediately without side effects.
	 *
	 * @returns Current plugin settings
	 */
	getSnapshot(): AgentClientPluginSettings;

	/**
	 * Update plugin settings.
	 *
	 * Merges the provided updates with existing settings and persists
	 * the changes. Notifies all subscribers after the update.
	 *
	 * @param updates - Partial settings object with properties to update
	 * @returns Promise that resolves when settings are saved
	 */
	updateSettings(updates: Partial<AgentClientPluginSettings>): Promise<void>;

	/**
	 * Subscribe to settings changes.
	 *
	 * The listener will be called whenever settings are updated.
	 * Used by React's useSyncExternalStore to detect changes and trigger re-renders.
	 *
	 * @param listener - Callback to invoke on settings changes
	 * @returns Unsubscribe function to remove the listener
	 */
	subscribe(listener: () => void): () => void;

	// ============================================================
	// Session Storage Methods
	// ============================================================

	/**
	 * Save a session to local storage.
	 *
	 * Updates existing session if sessionId matches.
	 * Maintains max 50 sessions, removing oldest when exceeded.
	 *
	 * @param info - Session metadata to save
	 * @returns Promise that resolves when session is saved
	 */
	saveSession(info: SavedSessionInfo): Promise<void>;

	/**
	 * Get saved sessions, optionally filtered by agentId and/or cwd.
	 *
	 * Returns sessions sorted by updatedAt (newest first).
	 *
	 * @param agentId - Optional filter by agent ID
	 * @param cwd - Optional filter by working directory
	 * @returns Array of saved session metadata
	 */
	getSavedSessions(agentId?: string, cwd?: string): SavedSessionInfo[];

	/**
	 * Delete a saved session by sessionId.
	 *
	 * @param sessionId - ID of session to delete
	 * @returns Promise that resolves when session is deleted
	 */
	deleteSession(sessionId: string): Promise<void>;

	// ============================================================
	// Session Message History Methods
	// ============================================================

	/**
	 * Save message history for a session.
	 *
	 * Saves the full ChatMessage[] to a separate file in sessions/ directory.
	 * Overwrites existing file if present.
	 *
	 * @param sessionId - Session ID
	 * @param agentId - Agent ID for validation
	 * @param messages - Chat messages to save
	 * @returns Promise that resolves when messages are saved
	 */
	saveSessionMessages(
		sessionId: string,
		agentId: string,
		messages: ChatMessage[],
		contextNotes?: ContextNote[],
	): Promise<void>;

	/**
	 * Load message history for a session.
	 *
	 * Reads from sessions/{sessionId}.json file.
	 * Returns null if file doesn't exist.
	 *
	 * @param sessionId - Session ID
	 * @returns Promise that resolves with messages or null if not found
	 */
	loadSessionMessages(sessionId: string): Promise<ChatMessage[] | null>;

	/**
	 * Load crystallized context notes for a session.
	 */
	loadSessionContextNotes(
		sessionId: string,
	): Promise<ContextNote[] | null>;

	/**
	 * Delete message history file for a session.
	 *
	 * Called when session is deleted from savedSessions.
	 * Silently succeeds if file doesn't exist.
	 *
	 * @param sessionId - Session ID
	 * @returns Promise that resolves when file is deleted
	 */
	deleteSessionMessages(sessionId: string): Promise<void>;

	// ============================================================
	// Tab State Methods (per-leaf convenience surface)
	// ============================================================

	/**
	 * Save per-leaf tab state atomically — replaces this leaf's slice
	 * in `perLeafTabStates` while preserving other leaves' slices.
	 *
	 * Used by useTabPersistence (Slice 5).
	 *
	 * @param leafId - Leaf identifier
	 * @param leafState - The leaf's full PerLeafTabState
	 */
	saveTabStateForLeaf(
		leafId: string,
		leafState: PerLeafTabState,
	): Promise<void>;

	/**
	 * Load just this leaf's saved tab state.
	 *
	 * Returns null if no state has been saved, the persisted blob is
	 * corrupted, or no entry matches `leafId`.
	 *
	 * @param leafId - Leaf identifier
	 * @returns The leaf's state, or null if none / corrupted / not present
	 */
	loadTabStateForLeaf(
		leafId: string,
	): Promise<PerLeafTabState | null>;
}

/** Listener callback invoked when settings change */
type Listener = () => void;

/**
 * Observable store for plugin settings implementing ISettingsAccess port.
 *
 * Manages plugin settings state and notifies subscribers of changes.
 * Designed to work with React's useSyncExternalStore hook for
 * automatic re-rendering when settings update.
 *
 * Pattern: Observer/Publisher-Subscriber
 */
export class SettingsService implements ISettingsAccess {
	/** Current settings state */
	private state: AgentClientPluginSettings;

	/** Set of registered listeners */
	private listeners = new Set<Listener>();

	/** Plugin instance for persistence */
	private plugin: AgentClientPlugin;

	/** Session storage delegate */
	private sessionStorage: SessionStorage;

	/**
	 * Serialized owner of the data.json flush.
	 *
	 * The in-memory merge in `updateSettings` is synchronous and safe, but the
	 * disk write (`plugin.saveSettings` -> `saveData`) was unserialized. The
	 * per-concern `sessionLock` and `tabStateLock` are deliberately separate,
	 * so a session write and a tab write could be in `saveData` concurrently
	 * and land out of order — the older payload winning on disk and dropping
	 * the newer concern's slice (surfacing only on the next restart). Chaining
	 * every flush on this queue makes the data.json write the single serialized
	 * writer of record. See `settings-flush-ordering` test +
	 * [[Resolver and Single-Writer Refactors]] candidate #5.
	 */
	private flushQueue: Promise<void> = Promise.resolve();

	/**
	 * Create a new settings store.
	 *
	 * @param initial - Initial settings state
	 * @param plugin - Plugin instance for saving settings
	 */
	constructor(initial: AgentClientPluginSettings, plugin: AgentClientPlugin) {
		this.state = initial;
		this.plugin = plugin;
		this.sessionStorage = new SessionStorage(plugin, this);
	}

	/**
	 * Get current settings snapshot.
	 *
	 * Used by React's useSyncExternalStore to read current state.
	 *
	 * @returns Current plugin settings
	 */
	getSnapshot = (): AgentClientPluginSettings => this.state;

	/**
	 * Update plugin settings.
	 *
	 * Merges the provided updates with existing settings, notifies subscribers,
	 * and persists changes to disk.
	 *
	 * @param updates - Partial settings object with properties to update
	 * @returns Promise that resolves when settings are saved
	 */
	async updateSettings(
		updates: Partial<AgentClientPluginSettings>,
	): Promise<void> {
		const next = { ...this.state, ...updates };
		this.state = next;

		// Sync with plugin.settings (required for saveSettings to persist correctly)
		this.plugin.settings = next;

		// Keep logger in sync with debug mode toggle
		updateDebugMode(next.debugMode);

		// Notify all subscribers
		for (const listener of this.listeners) {
			listener();
		}

		// Persist to disk through the serialized flush queue so concurrent
		// updates (the per-concern sessionLock and tabStateLock both feed here)
		// cannot reorder on disk and clobber each other's slice.
		return this.enqueueFlush();
	}

	/**
	 * Run the data.json flush serialized behind every prior flush. Each queued
	 * flush writes the LATEST in-memory `this.state` (the synchronous merge in
	 * `updateSettings` has already committed it), and the queue guarantees
	 * flushes run one at a time — so out-of-order disk landings are impossible
	 * by construction. The internal chain never rejects (a failed flush does
	 * not stall the queue); the caller still observes its own flush's rejection
	 * via the returned promise. Same construction as `SessionStore.enqueue` and
	 * the session/tab-state locks.
	 */
	private enqueueFlush(): Promise<void> {
		const run = this.flushQueue.then(() => this.plugin.saveSettings());
		this.flushQueue = run.catch(() => {});
		return run;
	}

	/**
	 * Subscribe to settings changes.
	 *
	 * The listener will be called whenever settings are updated via updateSettings().
	 * Used by React's useSyncExternalStore to detect changes.
	 *
	 * @param listener - Callback to invoke on settings changes
	 * @returns Unsubscribe function to remove the listener
	 */
	subscribe = (listener: Listener): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	/**
	 * Set entire settings object (legacy method).
	 *
	 * For backward compatibility with existing code.
	 * Delegates to updateSettings() for async persistence.
	 *
	 * @param next - New settings object
	 */
	set(next: AgentClientPluginSettings): void {
		// Delegate to async updateSettings
		// Note: Fire-and-forget - callers don't expect this to be async
		void this.updateSettings(next);
	}

	// ============================================================
	// Session Storage (delegated to SessionStorage)
	// ============================================================

	async saveSession(info: SavedSessionInfo): Promise<void> {
		return this.sessionStorage.saveSession(info);
	}

	getSavedSessions(agentId?: string, cwd?: string): SavedSessionInfo[] {
		return this.sessionStorage.getSavedSessions(agentId, cwd);
	}

	async deleteSession(sessionId: string): Promise<void> {
		return this.sessionStorage.deleteSession(sessionId);
	}

	async saveSessionMessages(
		sessionId: string,
		agentId: string,
		messages: ChatMessage[],
		contextNotes?: ContextNote[],
	): Promise<void> {
		return this.sessionStorage.saveSessionMessages(
			sessionId,
			agentId,
			messages,
			contextNotes,
		);
	}

	async loadSessionMessages(
		sessionId: string,
	): Promise<ChatMessage[] | null> {
		return this.sessionStorage.loadSessionMessages(sessionId);
	}

	async loadSessionContextNotes(
		sessionId: string,
	): Promise<ContextNote[] | null> {
		return this.sessionStorage.loadSessionContextNotes(sessionId);
	}

	async deleteSessionMessages(sessionId: string): Promise<void> {
		return this.sessionStorage.deleteSessionMessages(sessionId);
	}

	// ============================================================
	// Tab State (delegated to SessionStorage)
	// ============================================================

	async saveTabStateForLeaf(
		leafId: string,
		leafState: PerLeafTabState,
	): Promise<void> {
		return this.sessionStorage.saveTabStateForLeaf(leafId, leafState);
	}

	async loadTabStateForLeaf(
		leafId: string,
	): Promise<PerLeafTabState | null> {
		return this.sessionStorage.loadTabStateForLeaf(leafId);
	}

	async discardTabState(): Promise<void> {
		return this.sessionStorage.discardTabState();
	}

	/**
	 * Remove a single leaf's saved tab-state slice (reopen-restore prune).
	 * See [[ACP Restore Tabs on View Reopen]].
	 */
	async removeTabStateForLeaf(leafId: string): Promise<void> {
		return this.sessionStorage.removeTabStateForLeaf(leafId);
	}
}

/**
 * Create a new settings store instance.
 */
export const createSettingsService = (
	initial: AgentClientPluginSettings,
	plugin: AgentClientPlugin,
) => new SettingsService(initial, plugin);
