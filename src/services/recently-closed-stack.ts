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
export function pushClosedTab(
	stack: readonly ClosedTabRecord[],
	record: ClosedTabRecord,
	cap: number = RECENTLY_CLOSED_CAP,
): ClosedTabRecord[] {
	const next = [...stack, record];
	// Drop oldest when over cap (keep the most-recent `cap` entries).
	return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * Pop the most-recently-closed record (LIFO — the end of the array).
 * Returns the popped record (or null when empty) and the new stack.
 * Never mutates the input.
 */
export function popClosedTab(stack: readonly ClosedTabRecord[]): {
	record: ClosedTabRecord | null;
	stack: ClosedTabRecord[];
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
