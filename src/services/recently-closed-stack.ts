/**
 * Recently-closed-tab stack (F13 — Undo Close Tab).
 *
 * Pure helpers + record type for the browser-style "reopen closed tab"
 * (Cmd+Shift+T) feature. A LIFO stack of lightweight records captured when
 * a tab is closed; popping the head recreates a tab and restores its
 * conversation via the existing restore-by-sessionId path.
 *
 * In-memory only — the stack lives for the lifetime of a ChatView leaf and
 * is cleared on reload/restart (spec Decision: [[ACP Tab Persistence Across
 * Restarts]] (F01) covers tabs open at quit, the history surface covers
 * older closed sessions, so undo-close only needs current-session closes).
 *
 * No React here — these functions are unit-tested directly; useRecentlyClosedTabs
 * wraps them with a ref. See [[F13 Undo Close Tab]].
 */

import type { PerLeafTabState } from "../types/tab";

/**
 * Lightweight record of a closed tab — enough to recreate the tab and drive
 * the restore-by-sessionId path. The transcript and context notes are NOT
 * stored here; they are loaded on demand from disk at reopen time (same
 * `loadSessionMessages` / `loadSessionContextNotes` calls the mount-time
 * restore uses), keeping the in-memory footprint to identifiers only.
 */
export interface ClosedTabRecord {
	/**
	 * ACP session ID of the closed tab. Always non-null — a tab that never
	 * acquired a session has nothing worth restoring and is never captured
	 * (see buildClosedTabRecord).
	 */
	sessionId: string;
	/** Tab label at close time. */
	label: string;
	/** Whether the label was a manual rename (preserved on reopen, I56). */
	labelIsCustom: boolean;
	/** Agent ID the closed tab was running. */
	agentId: string;
	/** Tab-bar index at close time (best-effort reinsertion on reopen). */
	position: number;
}

/** Default stack depth. Browser keeps ~25; 10 is plenty for accidental closes. */
export const RECENTLY_CLOSED_CAP = 10;

/**
 * Push a record onto the stack (newest at the end). Caps the stack at `cap`
 * by dropping the oldest entries (front). Returns a new array — never mutates.
 */
export function pushClosedTab<T>(
	stack: readonly T[],
	record: T,
	cap: number = RECENTLY_CLOSED_CAP,
): T[] {
	const next = [...stack, record];
	// Drop oldest when over cap (keep the most-recent `cap` entries).
	return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * Pop the most-recently-closed record (LIFO — the end of the array).
 * Returns the popped record (or null when empty) and the new stack.
 * Never mutates the input.
 */
export function popClosedTab<T>(stack: readonly T[]): {
	record: T | null;
	stack: T[];
} {
	if (stack.length === 0) {
		return { record: null, stack: [] };
	}
	const record = stack[stack.length - 1];
	return { record, stack: stack.slice(0, stack.length - 1) };
}

/**
 * Build a ClosedTabRecord from a tab being closed, or return null when the
 * tab never acquired a session (sessionId === null) — a never-used blank
 * lazy tab has nothing meaningful to restore, so it is not captured.
 */
export function buildClosedTabRecord(args: {
	tab: { agentId: string; label: string; labelIsCustom?: boolean };
	sessionId: string | null;
	position: number;
}): ClosedTabRecord | null {
	if (args.sessionId === null) return null;
	return {
		sessionId: args.sessionId,
		label: args.tab.label,
		labelIsCustom: args.tab.labelIsCustom ?? false,
		agentId: args.tab.agentId,
		position: args.position,
	};
}

// ============================================================================
// Leaf granularity — reopen tabs on view reopen
// ([[ACP Restore Tabs on View Reopen]])
//
// The same pure LIFO helpers above serve a second, plugin-level stack whose
// records are whole-leaf snapshots. This stack must survive a ChatView leaf's
// unmount (its purpose is restoring the tab set AFTER the panel is closed), so
// it lives on the plugin — unlike F13's per-leaf ClosedTabRecord stack, which
// is held in a hook ref and dies with the leaf.
// ============================================================================

/**
 * Leaf-granularity recently-closed record: a full snapshot of a closed
 * ChatView leaf's tab set. Reuses PerLeafTabState (it already carries leafId —
 * needed to prune the orphaned data.json entry on adopt — plus tabs and
 * activeTabId).
 */
export type ClosedLeafRecord = PerLeafTabState;

/**
 * Build a ClosedLeafRecord from a leaf's just-saved PerLeafTabState, or return
 * null when the leaf has nothing worth restoring — a lone fresh tab with no
 * session and no unsent draft. Mirrors buildClosedTabRecord's skip-never-used
 * gate at leaf granularity: a multi-tab leaf, any tab with a session, or any
 * unsent draft is worth capturing.
 */
export function buildClosedLeafRecord(
	state: PerLeafTabState,
): ClosedLeafRecord | null {
	if (state.tabs.length === 0) return null;
	if (state.tabs.length > 1) return state;
	const only = state.tabs[0];
	const hasSession = only.sessionId !== null;
	const hasDraft = (only.draftText ?? "") !== "";
	return hasSession || hasDraft ? state : null;
}

/**
 * Resolve which PerLeafTabState a freshly-mounted ChatView leaf restores from.
 *
 * Restart path: Obsidian recreates the leaf with its original id, so the
 * synchronous id-match (`idMatch`) is non-null and wins — `adopt` is NOT
 * called, leaving the recently-closed stack intact (no spurious pop).
 *
 * Reopen path: a fresh leaf mints a new id that matches nothing on disk
 * (`idMatch` null), so we adopt the most-recently-closed snapshot from the
 * in-memory stack. `adopt` pops the stack, so it must run exactly once and
 * only when there is no id-match — this single chokepoint guarantees that.
 */
export function resolveRestoredLeaf(
	idMatch: PerLeafTabState | null,
	adopt: () => PerLeafTabState | null,
): PerLeafTabState | null {
	return idMatch ?? adopt();
}
