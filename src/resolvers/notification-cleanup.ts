/**
 * `decideNotificationCleanup` — the pure decision behind the notification
 * registry's cleanup pass (I52 round 9).
 *
 * WHY THIS EXISTS
 * Probes on Electron 43.8.3 / macOS (2026-11-13/14) showed that removing a
 * delivered notification shortly after another one is posted — by our code or
 * by the OS replacing a same-tag predecessor — makes the newer notification
 * lose its click when the user clicks it from Notification Center after about
 * a minute. Removing a neighbor 5 s after a posting lost the click (probe B′);
 * 60 s after was safe (probe B3). So nothing is removed until an app-wide quiet
 * period has passed since the latest posting in ANY vault window (the shared
 * clock lives in `window.localStorage`, which every vault window shares).
 *
 * The registry owns the side effects (close, remove by id, timers); this file
 * only decides what a pass does. See
 * [[I52 Notification click focuses wrong vault window]] § round 9.
 */

/** One retained notification, as the cleanup decision sees it. */
export interface CleanupEntry {
	/** The notification's tag (`<owner>:<suffix>`), unique per notification. */
	tag: string;
	/** The panel (tab) id that posted it. */
	owner: string;
	/** The owning panel unmounted (tab closed); remove at the next pass. */
	orphaned: boolean;
	/** Removal attempts that failed so far. */
	failedRemovals: number;
	/** A removal is in flight (async remover not yet settled). */
	pending: boolean;
}

export interface CleanupInput {
	/** Retained entries in insertion (posting) order. */
	entries: readonly CleanupEntry[];
	now: number;
	/** max(this window's last posting, the shared clock); -Infinity if none. */
	effectiveLastPostedAt: number;
	quietMs: number;
	cap: number;
	maxRetries: number;
}

export type CleanupDecision =
	| { kind: "defer"; delayMs: number }
	| {
			kind: "run";
			/** Superseded or orphaned entries: release only on a successful removal. */
			remove: string[];
			/** FIFO overflow: always released. */
			evict: string[];
	  };

/** Clamp a timer delay to [0, quietMs]; NaN → 0, +Infinity → quietMs. */
export function clampDelay(ms: number, quietMs: number): number {
	if (Number.isNaN(ms)) return 0;
	return Math.min(Math.max(ms, 0), quietMs);
}

/**
 * Parse a shared-clock value read from storage. Untrusted: another window, an
 * older build, or a clock step may have written it. Non-finite values, and
 * values more than `quietMs` in the future (a backward wall-clock step or a
 * malformed write), are treated as absent so they cannot defer cleanup without
 * bound or overflow a timer delay.
 */
export function parseSharedTimestamp(
	raw: string | null | undefined,
	now: number,
	quietMs: number,
): number | null {
	if (raw === null || raw === undefined) return null;
	const value = Number(raw);
	if (!Number.isFinite(value)) return null;
	if (value > now + quietMs) return null;
	return value;
}

export function decideNotificationCleanup(input: CleanupInput): CleanupDecision {
	const { entries, now, effectiveLastPostedAt, quietMs, cap, maxRetries } =
		input;

	const sincePosted = now - effectiveLastPostedAt;
	if (sincePosted < quietMs) {
		return {
			kind: "defer",
			delayMs: clampDelay(effectiveLastPostedAt + quietMs - now, quietMs),
		};
	}

	// FIFO counts every retained entry, so an entry whose removal keeps
	// failing still falls to the cap; the oldest entries that can be acted on
	// (no removal in flight) are evicted, which always releases them.
	const overflow = Math.max(0, entries.length - cap);
	const evict = entries
		.filter((entry) => !entry.pending)
		.slice(0, overflow)
		.map((entry) => entry.tag);
	const evicting = new Set(evict);

	// The newest entry per owner, by insertion order.
	const newestByOwner = new Map<string, string>();
	for (const entry of entries) newestByOwner.set(entry.owner, entry.tag);

	const remove: string[] = [];
	for (const entry of entries) {
		if (evicting.has(entry.tag)) continue;
		if (entry.pending || entry.failedRemovals >= maxRetries) continue;
		const superseded = newestByOwner.get(entry.owner) !== entry.tag;
		if (superseded || entry.orphaned) remove.push(entry.tag);
	}

	return { kind: "run", remove, evict };
}
