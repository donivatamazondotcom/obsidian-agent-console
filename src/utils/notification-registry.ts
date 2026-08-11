/**
 * Retains OS `Notification` objects so their `onclick` handler survives until
 * the user interacts with (or the OS dismisses) the toast.
 *
 * WHY THIS EXISTS: a `Notification` created as a local `const` inside a React
 * effect has no retained reference once the effect run exits, so the JS engine
 * is free to garbage-collect it — and with it, the `onclick` handler. Electron/
 * Chromium then delivers the click to a dead object, so clicking the toast does
 * nothing. This is worst once the banner auto-dismisses into macOS Notification
 * Center: the click arrives long after the effect ran, by which point GC has
 * almost certainly reclaimed the object. Documented Electron behavior:
 *   - electron/electron#12690 ("[macOS] Click event is not triggered from
 *     notification center if the user waits ~1 minute or more … the notification
 *     object is being garbage-collected … store it somewhere it won't be
 *     destructed")
 *   - electron/electron#16922 (notification lifetime too short)
 *
 * Fix: hold a strong reference in a module-level Set from creation until the
 * notification is clicked, closed, or errors — then release it so the Set does
 * not grow unbounded. Completion/permission notifications fire at most once per
 * turn-end while the app is unfocused, so the live set stays tiny.
 *
 * See [[I52 Notification click focuses wrong vault window]] recurrence
 * 2026-07-09 (the "click does nothing at times" symptom, distinct from the
 * earlier wrong-window symptom that PR #207's revealLeaf fix addressed).
 */

const liveNotifications = new Set<Notification>();

/**
 * Upper bound on retained notifications. Needed because the `close` event
 * NEVER fires on macOS (verified empirically 2026-07-29: not on banner
 * auto-dismiss after 45 s, not even on click) — so release-on-close alone
 * cannot bound the set. Insertion order of the Set gives FIFO eviction; the
 * evicted (oldest) notification is also `close()`d so its Notification Center
 * entry cannot linger as a stale click target.
 */
export const MAX_RETAINED_NOTIFICATIONS = 10;

/**
 * Retain `notification` and wire `onClick` as its click handler. The handler is
 * invoked on click, after which the notification is released from the registry.
 * The notification is also released when it is closed or errors, so an
 * un-clicked notification cannot leak.
 *
 * Call this INSTEAD of assigning `notification.onclick` directly — passing the
 * handler here guarantees the retain/release wiring cannot be clobbered by a
 * later `onclick =` assignment.
 */
export function retainNotification(
	notification: Notification,
	onClick: (event: Event) => void,
): void {
	liveNotifications.add(notification);

	// FIFO cap: evict-and-close the oldest entry once over the bound.
	if (liveNotifications.size > MAX_RETAINED_NOTIFICATIONS) {
		for (const oldest of liveNotifications) {
			liveNotifications.delete(oldest);
			try {
				oldest.close();
			} catch {
				// Closing a long-dead OS entry may throw; eviction must not.
			}
			break;
		}
	}

	const release = () => {
		liveNotifications.delete(notification);
	};

	notification.onclick = (event: Event) => {
		try {
			onClick(event);
		} finally {
			release();
		}
	};
	notification.onclose = release;
	notification.onerror = release;
}

/**
 * Close and release every retained notification. Called from the plugin's
 * `onunload` (I52 round 6, 2026-07-29): a Notification Center entry outlives
 * the JS context that created it across a plugin reload or Obsidian restart,
 * and clicking such an orphan either does nothing (its closures reference an
 * unmounted React tree and a detached leaf) or falls through to macOS default
 * app activation — foregrounding the most-recently-active window, i.e.
 * possibly the wrong vault. Sweeping them at unload makes orphan clicks
 * impossible. `.close()` verifiably removes an NC-resident entry on macOS
 * (probe 2026-07-29). Residual gap: a force-quit/crash skips `onunload`.
 */
export function closeAllNotifications(): void {
	for (const notification of liveNotifications) {
		try {
			notification.close();
		} catch {
			// Never let one bad entry abort the sweep.
		}
	}
	liveNotifications.clear();
}

/**
 * Attach the notification sweep to the window's `beforeunload` (I52 round 7,
 * 2026-08-11). Closing a vault WINDOW does not run plugin `onunload`
 * (verified empirically: a marker-instrumented `onunload` never fired on
 * `window.close()`, while an explicit `disablePlugin` did) — so the round-6
 * unload sweep never runs for closed windows, and their Notification Center
 * entries orphan exactly as in round 6. `beforeunload` DOES fire on window
 * close (and on a hard `Page.reload`), so hanging the sweep off it closes
 * the last graceful-teardown path. The `onunload` sweep stays for the
 * disable/quit paths.
 *
 * The listener is registered through the injected `register` seam so the
 * plugin can pass `registerDomEvent` (auto-detached on plugin unload) and
 * tests can pass a plain `addEventListener`.
 */
export function attachWindowCloseSweep(
	win: Window,
	register: (
		win: Window,
		event: "beforeunload",
		handler: () => void,
	) => void,
): void {
	register(win, "beforeunload", () => {
		closeAllNotifications();
	});
}

/** Test-only: number of notifications currently retained. */
export function __getRetainedNotificationCountForTests(): number {
	return liveNotifications.size;
}

/** Test-only: clear the registry between tests. */
export function __resetNotificationRegistryForTests(): void {
	liveNotifications.clear();
}
