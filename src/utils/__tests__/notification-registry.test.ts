import { describe, it, expect, vi, beforeEach } from "vitest";

import {
	retainNotification,
	__getRetainedNotificationCountForTests,
	__resetNotificationRegistryForTests,
} from "../notification-registry";

/**
 * Minimal stand-in for a Web `Notification`. The registry only touches
 * `onclick` / `onclose` / `onerror` and holds the object in a Set, so a plain
 * object with those slots is sufficient to exercise the retain/release logic.
 * We cannot force GC in jsdom, but the bug ("handler lost because the object
 * was never retained") is prevented by exactly this mechanism: the object is
 * held in the module registry from creation until click/close.
 */
function makeFakeNotification(): Notification {
	return {
		onclick: null,
		onclose: null,
		onerror: null,
	} as unknown as Notification;
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
});
