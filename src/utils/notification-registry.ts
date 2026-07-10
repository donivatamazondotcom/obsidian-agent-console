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

/** Test-only: number of notifications currently retained. */
export function __getRetainedNotificationCountForTests(): number {
	return liveNotifications.size;
}

/** Test-only: clear the registry between tests. */
export function __resetNotificationRegistryForTests(): void {
	liveNotifications.clear();
}
