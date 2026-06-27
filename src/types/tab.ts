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
	| "ready" // ● blue — idle, waiting for input
	| "busy" // ◐ blue, spinning — agent processing
	| "permission" // △ orange, pulsing — awaiting user approval
	| "error" // ✕ red — session error
	| "disconnected"; // ○ gray — session closed

/**
 * Metadata for a single tab in the tab bar.
 */
export interface TabInfo {
	/** Unique identifier for this tab */
	tabId: string;
	/** Agent ID running in this tab */
	agentId: string;
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
	 * ACP session ID for this tab. Explicitly null for tabs that have
	 * never had a message sent (lazy session lifecycle per spec
	 * Decision #2). Null is preserved on save (spec U33).
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
