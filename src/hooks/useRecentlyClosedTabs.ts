/**
 * useRecentlyClosedTabs — per-leaf recently-closed-tab stack (F13).
 *
 * Thin React wrapper over the pure recently-closed-stack helpers. Holds the
 * LIFO stack in a ref (no render depends on it — the reopen command reads it
 * imperatively and surfaces an empty state via Notice), so capturing or
 * reopening a tab never triggers a re-render of the chat view.
 *
 * In-memory only, scoped to the hosting ChatView leaf: the stack is created
 * when the leaf mounts and discarded when it unmounts (browser-like; cleared
 * on reload/restart). See [[F13 Undo Close Tab]].
 */

import { useCallback, useMemo, useRef } from "react";
import {
	type ClosedTabRecord,
	RECENTLY_CLOSED_CAP,
	popClosedTab,
	pushClosedTab,
} from "../services/recently-closed-stack";

export interface UseRecentlyClosedTabsReturn {
	/**
	 * Capture a closed tab. A null record (a never-used tab with no session)
	 * is ignored, so callers can pass buildClosedTabRecord(...) directly.
	 */
	capture: (record: ClosedTabRecord | null) => void;
	/**
	 * Pop and return the most-recently-closed record, or null when the stack
	 * is empty. The caller recreates the tab and restores its conversation.
	 */
	reopenLast: () => ClosedTabRecord | null;
	/** Number of records currently on the stack (for tests / diagnostics). */
	count: () => number;
	/**
	 * Session ids still reopenable from this stack. Their chats must not be
	 * evicted or cleaned up while they can come back (I202 review).
	 */
	sessionIds: () => string[];
	/** History record ids of the closed tabs that had one (I269). */
	recordIds: () => string[];
}

export function useRecentlyClosedTabs(
	cap: number = RECENTLY_CLOSED_CAP,
): UseRecentlyClosedTabsReturn {
	const stackRef = useRef<ClosedTabRecord[]>([]);

	const capture = useCallback(
		(record: ClosedTabRecord | null) => {
			if (!record) return; // never-used tab — nothing to restore
			stackRef.current = pushClosedTab(stackRef.current, record, cap);
		},
		[cap],
	);

	const reopenLast = useCallback((): ClosedTabRecord | null => {
		const { record, stack } = popClosedTab(stackRef.current);
		stackRef.current = stack;
		return record;
	}, []);

	const count = useCallback(() => stackRef.current.length, []);

	const sessionIds = useCallback(
		() => stackRef.current.map((r) => r.sessionId),
		[],
	);

	const recordIds = useCallback(
		() =>
			stackRef.current.flatMap((r) => (r.recordId ? [r.recordId] : [])),
		[],
	);

	return useMemo(
		() => ({ capture, reopenLast, count, sessionIds, recordIds }),
		[capture, reopenLast, count, sessionIds, recordIds],
	);
}
