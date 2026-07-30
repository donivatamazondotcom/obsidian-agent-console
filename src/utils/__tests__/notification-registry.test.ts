import { describe, it, expect, vi, beforeEach } from "vitest";

import {
	retainNotification,
	closeAllNotifications,
	MAX_RETAINED_NOTIFICATIONS,
	__getRetainedNotificationCountForTests,
	__resetNotificationRegistryForTests,
} from "../notification-registry";

/**
 * Minimal stand-in for a Web `Notification`. The registry only touches
 * `onclick` / `onclose` / `onerror` / `close()` and holds the object in a Set,
 * so a plain object with those slots is sufficient to exercise the
 * retain/release logic. We cannot force GC in jsdom, but the bug ("handler
 * lost because the object was never retained") is prevented by exactly this
 * mechanism: the object is held in the module registry from creation until
 * click/close.
 */
function makeFakeNotification(): Notification & { close: ReturnType<typeof vi.fn> } {
	return {
		onclick: null,
		onclose: null,
		onerror: null,
		close: vi.fn(),
	} as unknown as Notification & { close: ReturnType<typeof vi.fn> };
}

describe("notification-registry", () => {
	beforeEach(() => {
		__resetNotificationRegistryForTests();
	});

	it("retains the notification from creation until it is clicked", () => {
		const n = makeFakeNotification();
		const onClick = vi.fn();

		expect(__getRetainedNotificationCountForTests()).toBe(0);

		retainNotification(n, onClick);
		// The object is held by the registry, so it cannot be GC'd while the
		// banner sits in Notification Center waiting to be clicked.
		expect(__getRetainedNotificationCountForTests()).toBe(1);

		// Simulate the OS delivering the click.
		const event = new Event("click");
		n.onclick?.(event);

		// The caller's handler ran with the event...
		expect(onClick).toHaveBeenCalledTimes(1);
		expect(onClick).toHaveBeenCalledWith(event);
		// ...and the notification was released so the registry can't leak.
		expect(__getRetainedNotificationCountForTests()).toBe(0);
	});

	it("invokes the click handler even when the click arrives after a delay", () => {
		// Models the Notification Center case: the object must still be alive
		// (retained) and its handler intact when the click finally arrives.
		const n = makeFakeNotification();
		const onClick = vi.fn();
		retainNotification(n, onClick);

		// ...arbitrary time passes, effect run long exited...
		n.onclick?.(new Event("click"));

		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it("releases an un-clicked notification when it is closed", () => {
		const n = makeFakeNotification();
		retainNotification(n, vi.fn());
		expect(__getRetainedNotificationCountForTests()).toBe(1);

		n.onclose?.(new Event("close"));
		expect(__getRetainedNotificationCountForTests()).toBe(0);
	});

	it("releases a notification that errors so the registry cannot grow unbounded", () => {
		const n = makeFakeNotification();
		retainNotification(n, vi.fn());
		expect(__getRetainedNotificationCountForTests()).toBe(1);

		n.onerror?.(new Event("error"));
		expect(__getRetainedNotificationCountForTests()).toBe(0);
	});

	it("still releases the notification if the click handler throws", () => {
		const n = makeFakeNotification();
		const onClick = vi.fn(() => {
			throw new Error("handler boom");
		});
		retainNotification(n, onClick);

		expect(() => n.onclick?.(new Event("click"))).toThrow("handler boom");
		// finally{} release ran despite the throw.
		expect(__getRetainedNotificationCountForTests()).toBe(0);
	});

	// ============================================================
	// I52 round 6 (2026-07-29): orphaned notifications outlive the
	// plugin/renderer context. closeAllNotifications() is called from plugin
	// onunload so no stale Notification Center entry survives a plugin
	// reload / Obsidian restart — a stale entry's click either no-ops (dead
	// closures) or foregrounds the wrong vault window via macOS default
	// app activation.
	// ============================================================
	describe("closeAllNotifications (plugin unload sweep)", () => {
		it("closes and releases every retained notification", () => {
			const a = makeFakeNotification();
			const b = makeFakeNotification();
			retainNotification(a, vi.fn());
			retainNotification(b, vi.fn());
			expect(__getRetainedNotificationCountForTests()).toBe(2);

			closeAllNotifications();

			// The OS entries are removed (verified on macOS 2026-07-29:
			// .close() removes an NC-resident entry) and the refs released.
			expect(a.close).toHaveBeenCalledTimes(1);
			expect(b.close).toHaveBeenCalledTimes(1);
			expect(__getRetainedNotificationCountForTests()).toBe(0);
		});

		it("releases all notifications even when close() throws", () => {
			const a = makeFakeNotification();
			a.close.mockImplementation(() => {
				throw new Error("close boom");
			});
			const b = makeFakeNotification();
			retainNotification(a, vi.fn());
			retainNotification(b, vi.fn());

			expect(() => closeAllNotifications()).not.toThrow();
			expect(b.close).toHaveBeenCalledTimes(1);
			expect(__getRetainedNotificationCountForTests()).toBe(0);
		});

		it("is a no-op on an empty registry", () => {
			expect(() => closeAllNotifications()).not.toThrow();
			expect(__getRetainedNotificationCountForTests()).toBe(0);
		});
	});

	// ============================================================
	// I52 round 6: release-on-close is dead code on macOS — the `close`
	// event never fires (verified empirically: neither on banner
	// auto-dismiss after 45 s, nor even on click). Without a cap, every
	// un-clicked notification is retained until plugin unload. The FIFO
	// cap bounds the registry, closing the oldest entry on eviction so its
	// OS entry cannot linger as a stale click target either.
	// ============================================================
	describe("FIFO cap on retained notifications", () => {
		it("evicts (and closes) the oldest notification beyond the cap", () => {
			const oldest = makeFakeNotification();
			retainNotification(oldest, vi.fn());
			for (let i = 0; i < MAX_RETAINED_NOTIFICATIONS; i++) {
				retainNotification(makeFakeNotification(), vi.fn());
			}

			expect(__getRetainedNotificationCountForTests()).toBe(
				MAX_RETAINED_NOTIFICATIONS,
			);
			expect(oldest.close).toHaveBeenCalledTimes(1);
		});

		it("does not evict while at or under the cap", () => {
			const notifications = Array.from(
				{ length: MAX_RETAINED_NOTIFICATIONS },
				() => makeFakeNotification(),
			);
			for (const n of notifications) {
				retainNotification(n, vi.fn());
			}

			expect(__getRetainedNotificationCountForTests()).toBe(
				MAX_RETAINED_NOTIFICATIONS,
			);
			for (const n of notifications) {
				expect(n.close).not.toHaveBeenCalled();
			}
		});
	});
});
