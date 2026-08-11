import { describe, it, expect, vi, beforeEach } from "vitest";

import {
	retainNotification,
	closeAllNotifications,
	attachWindowCloseSweep,
	buildOwnedNotificationSweep,
	sweepOwnedNotificationsAtStartup,
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

	describe("attachWindowCloseSweep (I52 round 7)", () => {
		// Closing a vault WINDOW does not run plugin onunload (verified
		// empirically 2026-08-11: marker-instrumented onunload never fired on
		// window.close(), while an explicit disablePlugin did fire it) — so
		// the round-6 onunload sweep never runs for closed windows and their
		// notifications orphan into Notification Center. `beforeunload` DOES
		// fire on window close (same marker technique), so the sweep must
		// also hang off that event.
		it("sweeps retained notifications when the window fires beforeunload", () => {
			const n1 = makeFakeNotification();
			const n2 = makeFakeNotification();
			retainNotification(n1, vi.fn());
			retainNotification(n2, vi.fn());

			const win = new EventTarget() as unknown as Window;
			attachWindowCloseSweep(win, (w, event, handler) =>
				(w as unknown as EventTarget).addEventListener(event, handler),
			);

			(win as unknown as EventTarget).dispatchEvent(
				new Event("beforeunload"),
			);

			// Both OS entries were closed (removed from Notification Center)
			// and released — no orphan click target survives the window.
			expect(n1.close).toHaveBeenCalledTimes(1);
			expect(n2.close).toHaveBeenCalledTimes(1);
			expect(__getRetainedNotificationCountForTests()).toBe(0);
		});

		it("registers through the provided registrar so the listener detaches with the plugin", () => {
			const register = vi.fn();
			const win = new EventTarget() as unknown as Window;

			attachWindowCloseSweep(win, register);

			expect(register).toHaveBeenCalledTimes(1);
			expect(register).toHaveBeenCalledWith(
				win,
				"beforeunload",
				expect.any(Function),
			);
		});
	});

	// ============================================================
	// I52 round 7.5 (2026-08-11): startup sweep for orphans left by a
	// force-quit / crash — the one teardown path that skips BOTH plugin
	// onunload AND window beforeunload. Electron 43's remote.Notification
	// exposes getHistory/remove; the startup sweep removes THIS vault's own
	// notifications (matched by our tabIds) so a crashed session's
	// Notification Center orphans are cleared at next startup — without
	// touching other vault windows' live notifications (different tabIds) and
	// never via removeAll(). See I52 § Recurrence 2026-08-11 round 7.5.
	// ============================================================
	describe("buildOwnedNotificationSweep (pure)", () => {
		const ORIGIN = "app://obsidian.md";
		const id = (tag: string) => `n#${ORIGIN}#${tag}`;

		it("reconstructs an id per owned tab (crash case: getHistory is empty)", () => {
			const { idsToRemove } = buildOwnedNotificationSweep({
				ownedTabIds: ["tab-a", "tab-b"],
				origin: ORIGIN,
				historyIds: [],
			});
			expect(new Set(idsToRemove)).toEqual(
				new Set([id("tab-a"), id("tab-b")]),
			);
		});

		it("includes a history entry whose embedded tag is ours even if its origin differs", () => {
			// A same-process leftover carrying a different origin is still
			// matched by its embedded tag and removed by its own exact id.
			const foreignOriginId = "n#app://obsidian.md/x#tab-a";
			const { idsToRemove } = buildOwnedNotificationSweep({
				ownedTabIds: ["tab-a"],
				origin: ORIGIN,
				historyIds: [foreignOriginId],
			});
			expect(idsToRemove).toContain(foreignOriginId);
			expect(idsToRemove).toContain(id("tab-a"));
		});

		it("excludes a history entry whose tag is not ours (another window's tab)", () => {
			const { idsToRemove } = buildOwnedNotificationSweep({
				ownedTabIds: ["tab-a"],
				origin: ORIGIN,
				historyIds: [id("tab-other"), id("tab-a")],
			});
			expect(idsToRemove).not.toContain(id("tab-other"));
			expect(idsToRemove).toContain(id("tab-a"));
		});

		it("dedups when a history id equals a reconstructed id", () => {
			const { idsToRemove } = buildOwnedNotificationSweep({
				ownedTabIds: ["tab-a"],
				origin: ORIGIN,
				historyIds: [id("tab-a")],
			});
			expect(idsToRemove).toEqual([id("tab-a")]);
		});

		it("ignores malformed / non-notification history ids", () => {
			const { idsToRemove } = buildOwnedNotificationSweep({
				ownedTabIds: ["tab-a"],
				origin: ORIGIN,
				historyIds: ["", "garbage", "n#onlytwo", "x#y#tab-a"],
			});
			expect(idsToRemove).toEqual([id("tab-a")]);
		});

		it("returns empty when there are no owned tabs and no history", () => {
			expect(
				buildOwnedNotificationSweep({
					ownedTabIds: [],
					origin: ORIGIN,
					historyIds: [],
				}).idsToRemove,
			).toEqual([]);
		});

		it("ignores empty / non-string owned tab ids", () => {
			const { idsToRemove } = buildOwnedNotificationSweep({
				ownedTabIds: ["", "tab-a", undefined as unknown as string],
				origin: ORIGIN,
				historyIds: [],
			});
			expect(idsToRemove).toEqual([id("tab-a")]);
		});
	});

	describe("sweepOwnedNotificationsAtStartup (async runner)", () => {
		const ORIGIN = "app://obsidian.md";
		const id = (tag: string) => `n#${ORIGIN}#${tag}`;

		function makeStatics(
			overrides: Partial<{
				isSupported: () => boolean;
				getHistory: () => Promise<Array<{ id: string }>>;
				remove: (id: string) => Promise<void>;
			}> = {},
		) {
			return {
				isSupported: overrides.isSupported ?? (() => true),
				getHistory:
					overrides.getHistory ??
					vi.fn(async () => [] as Array<{ id: string }>),
				remove: overrides.remove ?? vi.fn(async (_id: string) => {}),
			};
		}

		it("is a no-op when the statics object is absent (non-Electron host)", async () => {
			const result = await sweepOwnedNotificationsAtStartup({
				notificationStatics: null,
				ownedTabIds: ["tab-a"],
				origin: ORIGIN,
			});
			expect(result.ran).toBe(false);
			expect(result.removed).toBe(0);
		});

		it("is a no-op when getHistory / remove are missing (older Electron)", async () => {
			const result = await sweepOwnedNotificationsAtStartup({
				notificationStatics: { isSupported: () => true } as never,
				ownedTabIds: ["tab-a"],
				origin: ORIGIN,
			});
			expect(result.ran).toBe(false);
		});

		it("is a no-op when isSupported() returns false", async () => {
			const remove = vi.fn(async (_id: string) => {});
			const result = await sweepOwnedNotificationsAtStartup({
				notificationStatics: makeStatics({
					isSupported: () => false,
					remove,
				}),
				ownedTabIds: ["tab-a"],
				origin: ORIGIN,
			});
			expect(result.ran).toBe(false);
			expect(remove).not.toHaveBeenCalled();
		});

		it("removes our own entries and never another window's (scoped to our tabIds)", async () => {
			const remove = vi.fn(async (_id: string) => {});
			const getHistory = vi.fn(async () => [
				{ id: id("tab-mine") },
				{ id: id("tab-other-window") },
			]);
			const result = await sweepOwnedNotificationsAtStartup({
				notificationStatics: makeStatics({ getHistory, remove }),
				ownedTabIds: ["tab-mine"],
				origin: ORIGIN,
			});
			expect(result.ran).toBe(true);
			const removed = remove.mock.calls.map((c) => c[0]);
			expect(removed).toContain(id("tab-mine"));
			expect(removed).not.toContain(id("tab-other-window"));
		});

		it("removes reconstructed ids even when getHistory resolves empty (the crash case)", async () => {
			const remove = vi.fn(async (_id: string) => {});
			const result = await sweepOwnedNotificationsAtStartup({
				notificationStatics: makeStatics({
					getHistory: vi.fn(async () => []),
					remove,
				}),
				ownedTabIds: ["tab-a", "tab-b"],
				origin: ORIGIN,
			});
			expect(result.ran).toBe(true);
			const removed = remove.mock.calls.map((c) => c[0]);
			expect(removed).toContain(id("tab-a"));
			expect(removed).toContain(id("tab-b"));
		});

		it("still removes reconstructed ids when getHistory rejects", async () => {
			const remove = vi.fn(async (_id: string) => {});
			const result = await sweepOwnedNotificationsAtStartup({
				notificationStatics: makeStatics({
					getHistory: vi.fn(async () => {
						throw new Error("getHistory boom");
					}),
					remove,
				}),
				ownedTabIds: ["tab-a"],
				origin: ORIGIN,
			});
			expect(result.ran).toBe(true);
			expect(remove.mock.calls.map((c) => c[0])).toContain(id("tab-a"));
		});

		it("continues removing after one remove rejects, and reports the error", async () => {
			const onError = vi.fn();
			const remove = vi.fn(async (rid: string) => {
				if (rid === id("tab-a")) throw new Error("remove boom");
			});
			const result = await sweepOwnedNotificationsAtStartup({
				notificationStatics: makeStatics({
					getHistory: vi.fn(async () => []),
					remove,
				}),
				ownedTabIds: ["tab-a", "tab-b"],
				origin: ORIGIN,
				onError,
			});
			expect(result.ran).toBe(true);
			const removed = remove.mock.calls.map((c) => c[0]);
			expect(removed).toContain(id("tab-a"));
			expect(removed).toContain(id("tab-b"));
			expect(onError).toHaveBeenCalled();
		});

		it("does nothing but reports ran=true when there are no owned tabs and empty history", async () => {
			const remove = vi.fn(async (_id: string) => {});
			const result = await sweepOwnedNotificationsAtStartup({
				notificationStatics: makeStatics({ remove }),
				ownedTabIds: [],
				origin: ORIGIN,
			});
			expect(result.ran).toBe(true);
			expect(result.removed).toBe(0);
			expect(remove).not.toHaveBeenCalled();
		});
	});
});
