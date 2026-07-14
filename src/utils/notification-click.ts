/**
 * Pure orchestrator for a system-notification click (completion and
 * permission notifications share it).
 *
 * Extracted from ChatPanel's effects so the click routing is unit-testable
 * (the `Notification` object and its `onclick` fire outside React and are
 * awkward to exercise in jsdom).
 *
 * Behavior:
 * 1. Switch to the tab that produced the notification (when tabs exist).
 * 2. Foreground the owning leaf/window via the Obsidian-sanctioned
 *    `revealLeaf` path (injected as `revealOwningLeaf`).
 * 3. **Bounded post-activation re-assert (I52 recurrence 2026-07-14):** on
 *    macOS, clicking a notification triggers an asynchronous app activation
 *    that foregrounds the most-recently-active window AFTER the synchronous
 *    click handler has run — so a single reveal can lose the race no matter
 *    how the synchronous calls are ordered. One recheck after the activation
 *    settles (`reassertDelayMs`, default 300 ms) re-runs the reveal ONLY if
 *    the owning window does not have focus. The recheck never reschedules
 *    (bounded), and never re-asserts the tab switch — the user may have
 *    deliberately moved in the meantime.
 *
 * See [[I52 Notification click focuses wrong vault window]].
 */

export const NOTIFICATION_REASSERT_DELAY_MS = 300;

export interface NotificationClickDeps {
	/** Stable id of the tab that produced the notification (ChatPanel viewId). */
	tabId: string;
	/** Switch to the producing tab. Absent for a floating chat / permission path. */
	onSwitchToTab?: (tabId: string) => void;
	/**
	 * Foreground the owning leaf/window via Obsidian's `revealLeaf` +
	 * `setActiveLeaf({ focus: true })`. Runs after the tab switch so the correct
	 * tab is active when the leaf surfaces.
	 */
	revealOwningLeaf: () => void;
	/**
	 * Whether the window OWNING this panel currently has OS focus — read from
	 * the panel container's `ownerDocument.hasFocus()` (popout-correct), NOT
	 * the global `activeDocument`.
	 */
	owningWindowHasFocus: () => boolean;
	/** Scheduler seam (window.setTimeout in production; injectable for tests). */
	schedule: (fn: () => void, ms: number) => void;
	/** Recheck delay override; defaults to {@link NOTIFICATION_REASSERT_DELAY_MS}. */
	reassertDelayMs?: number;
}

export function runNotificationClick(deps: NotificationClickDeps): void {
	deps.onSwitchToTab?.(deps.tabId);
	deps.revealOwningLeaf();
	deps.schedule(() => {
		// The OS activation has settled by now; if it foregrounded a different
		// window (we lost the race), re-assert the sanctioned reveal once.
		if (!deps.owningWindowHasFocus()) {
			deps.revealOwningLeaf();
		}
	}, deps.reassertDelayMs ?? NOTIFICATION_REASSERT_DELAY_MS);
}
