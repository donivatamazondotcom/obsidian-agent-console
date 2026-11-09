/**
 * Types for internal tabbed multi-session support.
 *
 * Each tab represents an independent agent session within a single
 * ChatView leaf. Tabs are the multiplexing unit — one Obsidian leaf,
 * N agent sessions.
 */

/**
 * Visual state of a tab, derived from SessionState + permission status.
 * Used by TabBar to render the correct icon shape/color/animation.
 *
 * Colorblind-safe: states are distinguished by shape first, color second,
 * animation third. No red/green contrast dependency.
 */
export type TabState =
	| "ready" // circle-dot, blue — idle, ready for input (incl. a new lazy tab)
	| "busy" // loader-circle, blue, spinning — agent processing
	| "permission" // triangle-alert, orange, pulsing — awaiting user approval
	| "error" // circle-x, red — session error
	| "disconnected" // circle, gray — placeholder before the panel reports
	| "released" // moon, muted — asleep to save memory; wakes on typing (I209)
	| "connecting" // circle-dashed, muted, slow spin — agent starting
	| "doneUnseen" // check, accent — finished, not viewed yet
	| "stoppedUnseen" // circle-alert, yellow — stopped early, not viewed yet
	| "failed"; // message-circle-warning, yellow — last message failed, its error banner is still up (I316)

/**
 * Unseen-result flag for a tab ([[Tab Attention States]] § Unseen flag).
 * Set when a turn ends while the user isn't looking; cleared on view or on
 * the next send. Runtime only — never persisted.
 */
export type TabUnseen = null | { kind: "done" } | { kind: "stopped" };

/** Runtime acquisition provenance. Reconstructed on restore; never persisted. */
export type TabOrigin = "fresh" | "restored";
/**
 * Metadata for a single tab in the tab bar.
 */
export interface TabInfo {
	/** Unique identifier for this tab */
	tabId: string;
	/** Agent ID running in this tab */
	agentId: string;
	/** Whether this runtime tab was deliberately created or restored for reading. */
	origin: TabOrigin;
	/** Short label displayed on the tab (≤25 chars) */
	label: string;
	/** True when the user manually renamed this tab; auto-derived labels must not overwrite it (I56). */
	labelIsCustom?: boolean;
	/** Current visual state for the tab icon */
	state: TabState;
	/** Timestamp when this tab was created */
	createdAt: Date;
}

/**
 * Persisted shape of a single tab in `data.json`.
 *
 * Distinct from runtime `TabInfo` above: omits `state` (derived at runtime
 * from session lifecycle) and `createdAt` (not needed for restoration).
 * Adds `sessionId`, `tabOrder`, and `scrollPosition` so a restart can
 * reopen the tab in the same place the user left it.
 *
 * Named separately from `TabInfo` because the runtime and persistence
 * shapes have different field sets and lifecycles — collapsing them into
 * one type would require optional fields that cannot be reliably
 * distinguished at the call site.
 *
 * See [[ACP Tab Persistence Across Restarts]] § Save.
 */
export interface PersistedTabInfo {
	/** Unique identifier for this tab */
	tabId: string;
	/** Agent ID running in this tab */
	agentId: string;
	/** Short label displayed on the tab (≤25 chars) */
	label: string;
	/** True when the user manually renamed this tab (I56). Persisted so the rename survives restart. */
	labelIsCustom?: boolean;
	/**
	 * ACP session ID for this tab. Explicitly null when no live session was
	 * acquired (for example, a restored read-only tab or failed initialization).
	 * Null is preserved on save (spec U33).
	 */
	sessionId: string | null;
	/** Display order within the leaf (0-indexed) */
	tabOrder: number;
	/** Last known scroll position in pixels (per I8 sticky-bottom logic) */
	scrollPosition: number;
	/**
	 * Unsent draft text in this tab's composer at save-time. Preserved so a
	 * half-typed prompt survives panel close/reopen and restart (it already
	 * survives tab switch in-memory, since inactive tabs stay mounted).
	 * Empty string when the composer is empty or after a send clears it.
	 * Optional for back-compat: pre-draft persisted state omits it and is
	 * read as "" (no draft).
	 *
	 * See [[ACP Preserve Unsent Draft Text Per Tab]].
	 */
	draftText?: string;
	/**
	 * Working directory this tab was launched in. Persisted so a restored
	 * tab keeps its cwd (suppresses the launch notice and shows the banner).
	 * Optional for back-compat: pre-cwd persisted state omits it and the
	 * tab falls through to the agent/global/vault default on restore.
	 */
	workingDirectory?: string;
	/**
	 * The tab's session mode id at save-time. Re-applied when the restored
	 * tab reconnects, instead of the agent's saved default, so a tab keeps
	 * its own mode across restart (I231). Never written to `lastUsedModes`.
	 * Omitted when no mode is known (connecting, or an agent without modes).
	 */
	modeId?: string;
	/**
	 * Kiro engine the tab's session ran on (D2). Written only next to a saved
	 * `sessionId`; read through `parseSessionEngine`. A restore prefers the
	 * session record's value and falls back to this one. Absent on tabs saved
	 * before D2 (unknown → the restore tries to load, as before).
	 */
	kiroEngine?: "v2" | "v3";
	/**
	 * The history record this tab writes to (I269). Written only next to a
	 * saved `sessionId`. Lets a tab find its transcript after a fallback even
	 * when the record write didn't land before a quit. Absent on tabs saved
	 * before I269 (the restore resolves the record by `sessionId`).
	 */
	recordId?: string;
}

/**
 * Per-leaf tab state for persistence.
 *
 * Each ChatView leaf saves its own state keyed by `leafId`; leaves do
 * not merge on restart (spec § Design Principles → Borrow from browser
 * UX). The plugin reads the array and matches each ChatView leaf's
 * `leafId` to its slice when Obsidian recreates the workspace.
 *
 * See [[ACP Tab Persistence Across Restarts]] § Save / § Restore.
 */
export interface PerLeafTabState {
	/** Obsidian leaf identifier this state belongs to */
	leafId: string;
	/** Tabs in this leaf, in display order (matches `tabOrder`) */
	tabs: PersistedTabInfo[];
	/** Currently active tab in this leaf */
	activeTabId: string;
}

/**
 * Per-tab agent-session lifecycle state. Single source of truth read by the
 * tab icon, send button, and header. Moved here from hooks/useTabSessionState
 * (utils-leaf refactor, G2) so resolvers and services can name it without a
 * hooks edge; the hook re-exports it for its ui consumers.
 */
export type TabSessionState =
	| "idle"
	| "connecting"
	| "ready"
	| "busy"
	| "permission"
	| "error"
	// I209: the live process was released after an hour idle. The session id
	// is kept; the next keystroke or send reconnects through the restored path.
	| "released";
