/**
 * Notification registry — lifetime of every OS notification Agent Console
 * posts. See [[I52 Notification click focuses wrong vault window]] rounds 3–9.
 *
 * Round 9 root cause (probes 2026-11-13/14, Electron 43.8.3, macOS): removing a
 * delivered notification shortly after another one is posted — by our code or
 * by the OS replacing a same-tag predecessor — makes the newer notification
 * lose its click when the user clicks it from Notification Center after about
 * a minute. Hence: a fresh tag per notification, and no removal until an
 * app-wide quiet minute has passed since the latest posting.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
	createNotificationRegistry,
	buildOwnedNotificationSweep,
	attachWindowCloseSweep,
	showOwnedNotification,
	disposeNotifications,
	initNotifications,
	MAX_RETAINED_NOTIFICATIONS,
	NOTIFICATION_QUIET_MS,
	MAX_REMOVAL_RETRIES,
	SHARED_LAST_POSTED_KEY,
	SHARED_LAST_REMOVED_KEY,
	__getRetainedNotificationCountForTests,
	__resetNotificationRegistryForTests,
	type NotificationRegistry,
	type NotificationRegistryDeps,
} from "../notification-registry";

const ORIGIN = "app://obsidian.md";
const Q = NOTIFICATION_QUIET_MS;
const idFor = (tag: string) => `n#${ORIGIN}#${tag}`;

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeNotification {
	title: string;
	options: NotificationOptions | undefined;
	tag: string;
	onclick: ((ev: Event) => unknown) | null;
	onclose: ((ev: Event) => unknown) | null;
	onerror: ((ev: Event) => unknown) | null;
	close: ReturnType<typeof vi.fn>;
}

function makeCtor() {
	const made: FakeNotification[] = [];
	class Ctor {
		title: string;
		options: NotificationOptions | undefined;
		tag: string;
		onclick: ((ev: Event) => unknown) | null = null;
		onclose: ((ev: Event) => unknown) | null = null;
		onerror: ((ev: Event) => unknown) | null = null;
		close = vi.fn();
		constructor(title: string, options?: NotificationOptions) {
			this.title = title;
			this.options = options;
			this.tag = options?.tag ?? "";
			made.push(this as unknown as FakeNotification);
		}
	}
	return {
		Ctor: Ctor as unknown as new (
			title: string,
			options?: NotificationOptions,
		) => Notification,
		made,
	};
}

function makeClock(start = 1_000_000_000) {
	let t = start;
	let seq = 0;
	const timers = new Map<number, { at: number; fn: () => void }>();
	return {
		now: () => t,
		schedule: (fn: () => void, ms: number) => {
			const id = ++seq;
			timers.set(id, { at: t + ms, fn });
			return id;
		},
		cancel: (id: number) => {
			timers.delete(id);
		},
		pending: () => timers.size,
		nextAt: () => Math.min(...[...timers.values()].map((x) => x.at)),
		advance(ms: number) {
			const end = t + ms;
			for (;;) {
				let next: [number, { at: number; fn: () => void }] | undefined;
				for (const e of timers) {
					if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
				}
				if (!next) break;
				timers.delete(next[0]);
				t = next[1].at;
				next[1].fn();
			}
			t = end;
		},
	};
}

function makeStore(init: Record<string, string> = {}) {
	const m = new Map(Object.entries(init));
	return {
		m,
		getItem: vi.fn((k: string) => (m.has(k) ? (m.get(k) as string) : null)),
		setItem: vi.fn((k: string, v: string) => {
			m.set(k, v);
		}),
	};
}

interface Harness {
	reg: NotificationRegistry;
	ctor: ReturnType<typeof makeCtor>;
	clock: ReturnType<typeof makeClock>;
	store: ReturnType<typeof makeStore>;
	raise: ReturnType<typeof vi.fn>;
	remove: ReturnType<typeof vi.fn>;
	post: (owner: string, onClick?: (ev: Event) => void) => FakeNotification;
}

function harness(
	opts: {
		store?: ReturnType<typeof makeStore> | null;
		remove?: ((id: string) => unknown) | null;
	} = {},
): Harness {
	const ctor = makeCtor();
	const clock = makeClock();
	const store = opts.store === undefined ? makeStore() : opts.store;
	const raise = vi.fn();
	const deps: NotificationRegistryDeps = {
		NotificationCtor: () => ctor.Ctor,
		store: () => store,
		schedule: clock.schedule,
		cancel: clock.cancel,
		now: clock.now,
		raiseOwningWindow: raise,
		log: () => {},
	};
	const reg = createNotificationRegistry(deps);
	const remove = vi.fn(opts.remove ?? (() => undefined));
	if (opts.remove !== null) {
		reg.setNotificationRemover({ statics: { remove }, origin: ORIGIN });
	}
	return {
		reg,
		ctor,
		clock,
		store: store as ReturnType<typeof makeStore>,
		raise,
		remove,
		post: (owner, onClick = vi.fn()) => {
			const n = reg.showOwnedNotification({
				owner,
				title: `t-${owner}`,
				options: { body: "b" },
				onClick,
			});
			return n as unknown as FakeNotification;
		},
	};
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Creation — the root cause
// ---------------------------------------------------------------------------

describe("showOwnedNotification: a fresh tag per notification (I52 round 9 root cause)", () => {
	it("passes two distinct owner-prefixed tags to the OS for one tab's two notifications", () => {
		const h = harness();
		h.post("tab-a");
		h.post("tab-a");

		const tags = h.ctor.made.map((n) => n.options?.tag);
		expect(tags[0]).not.toBe(tags[1]);
		for (const tag of tags) expect(tag).toMatch(/^tab-a:.+/);
	});

	it("overrides a caller-supplied tag", () => {
		const h = harness();
		h.reg.showOwnedNotification({
			owner: "tab-a",
			title: "x",
			options: { body: "b", tag: "tab-a" },
			onClick: vi.fn(),
		});
		expect(h.ctor.made[0].options?.tag).toMatch(/^tab-a:.+/);
	});

	it("forwards the title and body", () => {
		const h = harness();
		h.post("tab-a");
		expect(h.ctor.made[0].title).toBe("t-tab-a");
		expect(h.ctor.made[0].options?.body).toBe("b");
	});

	it("closes and removes nothing at creation, even over the cap or with an existing entry for the tab", () => {
		const h = harness();
		for (let i = 0; i < MAX_RETAINED_NOTIFICATIONS + 3; i++) h.post("tab-a");
		for (const n of h.ctor.made) expect(n.close).not.toHaveBeenCalled();
		expect(h.remove).not.toHaveBeenCalled();
		expect(h.reg.__count()).toBe(MAX_RETAINED_NOTIFICATIONS + 3);
	});

	it("writes the app-wide posted-at clock and arms one pass a quiet period out", () => {
		const h = harness();
		h.post("tab-a");
		expect(h.store.setItem).toHaveBeenCalledWith(
			SHARED_LAST_POSTED_KEY,
			String(h.clock.now()),
		);
		expect(h.clock.pending()).toBe(1);
		expect(h.clock.nextAt() - h.clock.now()).toBe(Q);
	});
});

// ---------------------------------------------------------------------------
// Cleanup pass
// ---------------------------------------------------------------------------

describe("cleanup pass: only after an app-wide quiet period", () => {
	it("does not remove anything before the quiet period; a new posting pushes it out", () => {
		const h = harness();
		h.post("tab-a");
		h.clock.advance(Q - 1_000);
		h.post("tab-a");
		h.clock.advance(Q - 1_000);
		expect(h.remove).not.toHaveBeenCalled();
		h.clock.advance(1_000);
		expect(h.remove).toHaveBeenCalledTimes(1);
	});

	it("removes a tab's superseded notification by exact id, keeps its newest, leaves other tabs alone", () => {
		const h = harness();
		const a1 = h.post("tab-a");
		h.post("tab-b");
		const a2 = h.post("tab-a");
		h.clock.advance(Q);

		expect(h.remove).toHaveBeenCalledTimes(1);
		expect(h.remove).toHaveBeenCalledWith(idFor(a1.tag));
		expect(a1.close).toHaveBeenCalledTimes(1);
		expect(a2.close).not.toHaveBeenCalled();
		expect(h.reg.__count()).toBe(2);
	});

	it("defers when another window posted within the quiet period, then runs once it has aged", () => {
		const h = harness();
		h.post("tab-a");
		h.post("tab-a");
		h.clock.advance(Q - 10_000);
		// Another vault window posts now.
		h.store.m.set(SHARED_LAST_POSTED_KEY, String(h.clock.now()));
		h.clock.advance(10_000);
		expect(h.remove).not.toHaveBeenCalled();
		h.clock.advance(Q);
		expect(h.remove).toHaveBeenCalledTimes(1);
	});

	it("records the app-wide removed-at clock when it removed something", () => {
		const h = harness();
		h.post("tab-a");
		h.post("tab-a");
		h.clock.advance(Q);
		expect(h.store.setItem).toHaveBeenCalledWith(
			SHARED_LAST_REMOVED_KEY,
			String(h.clock.now()),
		);
	});

	it("reads no clock and re-arms nothing when the registry is empty", () => {
		const h = harness();
		const n = h.post("tab-a");
		n.onclick?.(new Event("click"));
		expect(h.reg.__count()).toBe(0);
		const reads = h.store.getItem.mock.calls.length;
		h.clock.advance(Q);
		expect(h.store.getItem.mock.calls.length).toBe(reads);
		expect(h.clock.pending()).toBe(0);
	});

	it("evicts the oldest entries down to the cap after a burst (soft cap), by exact id", () => {
		const h = harness();
		const burst = Array.from({ length: 12 }, (_, i) => {
			const n = h.post(`tab-${i}`);
			h.clock.advance(5_000);
			return n;
		});
		expect(h.reg.__count()).toBe(12);
		h.clock.advance(Q);
		expect(h.reg.__count()).toBe(MAX_RETAINED_NOTIFICATIONS);
		expect(h.remove.mock.calls.map((c) => c[0])).toEqual([
			idFor(burst[0].tag),
			idFor(burst[1].tag),
		]);
	});

	it("does not skip entries when close() fires onclose synchronously mid-pass", () => {
		const h = harness();
		const a = [h.post("tab-a"), h.post("tab-a"), h.post("tab-a")];
		for (const n of a) {
			n.close.mockImplementation(() => n.onclose?.(new Event("close")));
		}
		h.clock.advance(Q);
		expect(h.remove.mock.calls.map((c) => c[0])).toEqual([
			idFor(a[0].tag),
			idFor(a[1].tag),
		]);
		expect(h.reg.__count()).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Shared clock: never throws, range-checked
// ---------------------------------------------------------------------------

describe("shared quiet clock: never throws, never trusted blindly", () => {
	it("still posts and arms a pass when the store's setItem throws", () => {
		const store = makeStore();
		store.setItem.mockImplementation(() => {
			throw new Error("QuotaExceededError");
		});
		const h = harness({ store });
		expect(() => h.post("tab-a")).not.toThrow();
		expect(h.ctor.made).toHaveLength(1);
		expect(h.clock.pending()).toBe(1);
	});

	it("falls back to the local clock when getItem throws in a pass", () => {
		const store = makeStore();
		store.getItem.mockImplementation(() => {
			throw new Error("SecurityError");
		});
		const h = harness({ store });
		h.post("tab-a");
		h.post("tab-a");
		expect(() => h.clock.advance(Q)).not.toThrow();
		expect(h.remove).toHaveBeenCalledTimes(1);
	});

	it("still arms a pass when getItem throws at unmount", () => {
		const store = makeStore();
		const h = harness({ store });
		h.post("tab-a");
		h.clock.advance(Q);
		store.getItem.mockImplementation(() => {
			throw new Error("SecurityError");
		});
		expect(() => h.reg.closeNotificationsForOwner("tab-a")).not.toThrow();
		expect(h.clock.pending()).toBe(1);
	});

	it.each([["Infinity"], ["abc"], [String(1_000_000_000 + 10 * Q)]])(
		"ignores an untrustworthy shared value (%s) and uses the local clock",
		(raw) => {
			const store = makeStore({ [SHARED_LAST_POSTED_KEY]: raw });
			store.setItem.mockImplementation(() => {}); // keep the bad value
			const h = harness({ store });
			h.post("tab-a");
			h.post("tab-a");
			h.clock.advance(Q);
			expect(h.remove).toHaveBeenCalledTimes(1);
		},
	);

	it("never arms a delay longer than the quiet period for a value in the near future", () => {
		const h = harness();
		h.post("tab-a");
		h.clock.advance(Q); // pass ran, nothing pending
		h.store.m.set(SHARED_LAST_POSTED_KEY, String(h.clock.now() + 50_000));
		h.reg.closeNotificationsForOwner("tab-a");
		expect(h.clock.nextAt() - h.clock.now()).toBeLessThanOrEqual(Q);
	});
});

// ---------------------------------------------------------------------------
// Panel unmount (tab closed)
// ---------------------------------------------------------------------------

describe("closeNotificationsForOwner: mark now, remove after the quiet period", () => {
	it("makes no removal call at unmount; the next pass removes the tab's entries by exact id", () => {
		const h = harness();
		const mine = h.post("tab-closed");
		const other = h.post("tab-open");
		h.reg.closeNotificationsForOwner("tab-closed");
		expect(h.remove).not.toHaveBeenCalled();
		expect(mine.close).not.toHaveBeenCalled();

		h.clock.advance(Q);
		expect(h.remove).toHaveBeenCalledWith(idFor(mine.tag));
		expect(other.close).not.toHaveBeenCalled();
		expect(h.reg.__count()).toBe(1);
	});

	it("arms a pass when the tab closes after the last pass already ran", () => {
		const h = harness();
		const n = h.post("tab-a");
		h.clock.advance(Q); // pass ran; nothing pending
		expect(h.clock.pending()).toBe(0);
		h.clock.advance(10 * Q);

		h.reg.closeNotificationsForOwner("tab-a");
		expect(h.clock.pending()).toBe(1);
		h.clock.advance(0);
		expect(h.remove).toHaveBeenCalledWith(idFor(n.tag));
	});

	it("never moves an armed pass later", () => {
		const h = harness();
		h.post("tab-a");
		const deadline = h.clock.nextAt();
		h.clock.advance(30_000);
		h.store.m.set(SHARED_LAST_POSTED_KEY, String(h.clock.now()));
		h.reg.closeNotificationsForOwner("tab-a");
		expect(h.clock.pending()).toBe(1);
		expect(h.clock.nextAt()).toBe(deadline);
	});

	it("is a no-op for an owner with no notifications", () => {
		const h = harness();
		h.post("tab-open");
		h.clock.advance(Q);
		h.reg.closeNotificationsForOwner("tab-unknown");
		expect(h.clock.pending()).toBe(0);
	});

	it("marks only the entries that exist at unmount (error-boundary remount reuses the id)", () => {
		const h = harness();
		const old = h.post("tab-a");
		h.reg.closeNotificationsForOwner("tab-a");
		const onClick = vi.fn();
		const fresh = h.post("tab-a", onClick);
		h.clock.advance(Q);

		expect(h.remove).toHaveBeenCalledWith(idFor(old.tag));
		expect(h.remove).not.toHaveBeenCalledWith(idFor(fresh.tag));
		fresh.onclick?.(new Event("click"));
		expect(onClick).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// Clicks
// ---------------------------------------------------------------------------

describe("click routing", () => {
	it("runs the caller's handler for a live entry and releases it", () => {
		const h = harness();
		const onClick = vi.fn();
		const n = h.post("tab-a", onClick);
		const ev = new Event("click");
		n.onclick?.(ev);
		expect(onClick).toHaveBeenCalledWith(ev);
		expect(h.raise).not.toHaveBeenCalled();
		expect(h.reg.__count()).toBe(0);
	});

	it("only raises the owning window for a closed tab's entry, never the tab switch", () => {
		const h = harness();
		const onClick = vi.fn();
		const n = h.post("tab-closed", onClick);
		h.reg.closeNotificationsForOwner("tab-closed");
		n.onclick?.(new Event("click"));
		expect(onClick).not.toHaveBeenCalled();
		expect(h.raise).toHaveBeenCalledTimes(1);
		expect(h.reg.__count()).toBe(0);
	});

	it("still releases when the caller's handler throws", () => {
		const h = harness();
		const n = h.post("tab-a", () => {
			throw new Error("handler boom");
		});
		expect(() => n.onclick?.(new Event("click"))).toThrow("handler boom");
		expect(h.reg.__count()).toBe(0);
	});

	it("releases an entry that errors before any removal", () => {
		const h = harness();
		const n = h.post("tab-a");
		n.onerror?.(new Event("error"));
		expect(h.reg.__count()).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Removal failures
// ---------------------------------------------------------------------------

describe("removal failures keep the entry and retry", () => {
	it("keeps a superseded entry whose remove() threw, ignores its late close event, retries remove() only, and gives up", () => {
		const h = harness({
			remove: () => {
				throw new Error("remove boom");
			},
		});
		const a1 = h.post("tab-a");
		h.post("tab-a");
		h.clock.advance(Q);
		expect(h.reg.__count()).toBe(2);
		expect(a1.close).toHaveBeenCalledTimes(1);

		// The OS delivers `close` 3–83 ms after close(); it must not release.
		a1.onclose?.(new Event("close"));
		expect(h.reg.__count()).toBe(2);

		h.clock.advance(10 * Q);
		expect(h.remove).toHaveBeenCalledTimes(MAX_REMOVAL_RETRIES);
		expect(a1.close).toHaveBeenCalledTimes(1);
		expect(h.reg.__count()).toBe(2);
		expect(h.clock.pending()).toBe(0);
	});

	it("keeps an entry whose remove() rejects and arms a retry pass", async () => {
		const h = harness({ remove: () => Promise.reject(new Error("rejected")) });
		h.post("tab-a");
		h.post("tab-a");
		h.clock.advance(Q);
		await flush();
		expect(h.reg.__count()).toBe(2);
		expect(h.clock.pending()).toBe(1);
	});

	it("releases an entry once a thenable remove() fulfills", async () => {
		const h = harness({ remove: () => Promise.resolve() });
		h.post("tab-a");
		h.post("tab-a");
		h.clock.advance(Q);
		await flush();
		expect(h.reg.__count()).toBe(1);
	});

	it("does nothing when a removal rejects after teardown", async () => {
		let reject: (e: Error) => void = () => {};
		const h = harness({
			remove: () =>
				new Promise<void>((_res, rej) => {
					reject = rej;
				}),
		});
		h.post("tab-a");
		h.post("tab-a");
		h.clock.advance(Q);
		h.reg.closeAllNotifications();
		h.reg.disposeNotifications();
		reject(new Error("late"));
		await flush();
		expect(h.clock.pending()).toBe(0);
		expect(h.reg.__count()).toBe(0);
	});

	it("keeps superseded entries when no remover is configured, even after their close event", () => {
		const h = harness({ remove: null });
		const a1 = h.post("tab-a");
		h.post("tab-a");
		h.clock.advance(Q);
		expect(a1.close).toHaveBeenCalledTimes(1);
		a1.onclose?.(new Event("close"));
		expect(h.reg.__count()).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

describe("teardown", () => {
	it("closeAllNotifications removes every entry by exact id, clears the map, and cancels the pass", () => {
		const h = harness();
		const a = h.post("tab-a");
		const b = h.post("tab-b");
		h.reg.closeAllNotifications();
		expect(h.remove.mock.calls.map((c) => c[0])).toEqual([
			idFor(a.tag),
			idFor(b.tag),
		]);
		expect(a.close).toHaveBeenCalledTimes(1);
		expect(h.reg.__count()).toBe(0);
		expect(h.clock.pending()).toBe(0);
		h.clock.advance(10 * Q);
		expect(h.remove).toHaveBeenCalledTimes(2);
	});

	it("releases every entry at teardown even when remove() throws", () => {
		const h = harness({
			remove: () => {
				throw new Error("boom");
			},
		});
		h.post("tab-a");
		h.post("tab-b");
		expect(() => h.reg.closeAllNotifications()).not.toThrow();
		expect(h.reg.__count()).toBe(0);
	});

	it("makes no remover call when the map is empty", () => {
		const h = harness();
		h.reg.closeAllNotifications();
		expect(h.remove).not.toHaveBeenCalled();
	});

	it("posts nothing and arms nothing after disposeNotifications", () => {
		const h = harness();
		h.reg.disposeNotifications();
		const n = h.reg.showOwnedNotification({
			owner: "tab-a",
			title: "x",
			options: {},
			onClick: vi.fn(),
		});
		expect(n).toBeNull();
		expect(h.ctor.made).toHaveLength(0);
		expect(h.clock.pending()).toBe(0);
	});

	it("posts again after re-activation on the next load (plugin toggle)", () => {
		const h = harness();
		h.reg.disposeNotifications();
		h.reg.activateNotifications();
		h.post("tab-a");
		expect(h.ctor.made).toHaveLength(1);
	});

	it("the beforeunload sweep empties the registry but does not dispose it", () => {
		const h = harness();
		h.post("tab-a");
		const win = new EventTarget() as unknown as Window;
		h.reg.attachWindowCloseSweep(win, (w, event, handler) =>
			(w as unknown as EventTarget).addEventListener(event, handler),
		);
		(win as unknown as EventTarget).dispatchEvent(new Event("beforeunload"));
		expect(h.reg.__count()).toBe(0);
		h.post("tab-a");
		expect(h.ctor.made).toHaveLength(2);
	});

	it("attachWindowCloseSweep registers through the provided registrar", () => {
		const register = vi.fn();
		const win = new EventTarget() as unknown as Window;
		attachWindowCloseSweep(win, register);
		expect(register).toHaveBeenCalledWith(
			win,
			"beforeunload",
			expect.any(Function),
		);
	});
});

// ---------------------------------------------------------------------------
// Startup sweep
// ---------------------------------------------------------------------------

describe("buildOwnedNotificationSweep (pure)", () => {
	it("reconstructs a legacy id per owned tab (crash case: empty history)", () => {
		const { idsToRemove } = buildOwnedNotificationSweep({
			ownedTabIds: ["tab-a", "tab-b"],
			origin: ORIGIN,
			historyIds: [],
		});
		expect(new Set(idsToRemove)).toEqual(new Set([idFor("tab-a"), idFor("tab-b")]));
	});

	it("matches round-9 tags (tabId:suffix) and legacy exact tags, never another window's", () => {
		const { idsToRemove } = buildOwnedNotificationSweep({
			ownedTabIds: ["tab-abc1"],
			origin: ORIGIN,
			historyIds: [
				idFor("tab-abc1:x1"),
				idFor("tab-abc1"),
				idFor("tab-abc12:x2"),
				idFor("tab-other:x3"),
			],
		});
		expect(idsToRemove).toContain(idFor("tab-abc1:x1"));
		expect(idsToRemove).toContain(idFor("tab-abc1"));
		expect(idsToRemove).not.toContain(idFor("tab-abc12:x2"));
		expect(idsToRemove).not.toContain(idFor("tab-other:x3"));
	});

	it("matches a history entry with a different origin by its embedded tag", () => {
		const foreign = "n#app://obsidian.md/x#tab-a:z";
		const { idsToRemove } = buildOwnedNotificationSweep({
			ownedTabIds: ["tab-a"],
			origin: ORIGIN,
			historyIds: [foreign],
		});
		expect(idsToRemove).toContain(foreign);
	});

	it("dedups, and ignores malformed history ids and empty owned ids", () => {
		const { idsToRemove } = buildOwnedNotificationSweep({
			ownedTabIds: ["", "tab-a", undefined as unknown as string],
			origin: ORIGIN,
			historyIds: [idFor("tab-a"), "", "garbage", "n#onlytwo", "x#y#tab-a"],
		});
		expect(idsToRemove).toEqual([idFor("tab-a")]);
	});
});

describe("sweepOwnedNotificationsAtStartup", () => {
	function statics(
		overrides: Partial<{
			isSupported: () => boolean;
			getHistory: () => Promise<Array<{ id: string }>>;
			remove: (id: string) => unknown;
		}> = {},
	) {
		return {
			isSupported: overrides.isSupported ?? (() => true),
			getHistory: vi.fn(overrides.getHistory ?? (async () => [])),
			remove: vi.fn(overrides.remove ?? (async () => {})),
		};
	}

	it("is a no-op without the Electron statics, or when unsupported", async () => {
		const h = harness();
		expect(
			(await h.reg.sweepOwnedNotificationsAtStartup({
				notificationStatics: null,
				ownedTabIds: ["tab-a"],
				origin: ORIGIN,
			})).ran,
		).toBe(false);
		const s = statics({ isSupported: () => false });
		expect(
			(await h.reg.sweepOwnedNotificationsAtStartup({
				notificationStatics: s,
				ownedTabIds: ["tab-a"],
				origin: ORIGIN,
			})).ran,
		).toBe(false);
		expect(s.remove).not.toHaveBeenCalled();
	});

	it("removes our own entries immediately when nothing was posted recently", async () => {
		const h = harness();
		const s = statics({
			getHistory: async () => [
				{ id: idFor("tab-mine:1") },
				{ id: idFor("tab-other-window:1") },
			],
		});
		const result = await h.reg.sweepOwnedNotificationsAtStartup({
			notificationStatics: s,
			ownedTabIds: ["tab-mine"],
			origin: ORIGIN,
		});
		expect(result.ran).toBe(true);
		const removed = s.remove.mock.calls.map((c) => c[0]);
		expect(removed).toContain(idFor("tab-mine:1"));
		expect(removed).toContain(idFor("tab-mine"));
		expect(removed).not.toContain(idFor("tab-other-window:1"));
	});

	it("waits for the app-wide quiet period before reading history", async () => {
		const h = harness();
		h.store.m.set(SHARED_LAST_POSTED_KEY, String(h.clock.now() - 20_000));
		const s = statics();
		const p = h.reg.sweepOwnedNotificationsAtStartup({
			notificationStatics: s,
			ownedTabIds: ["tab-a"],
			origin: ORIGIN,
		});
		await flush();
		expect(s.getHistory).not.toHaveBeenCalled();
		h.clock.advance(40_000);
		const result = await p;
		expect(result.ran).toBe(true);
		expect(s.getHistory).toHaveBeenCalledTimes(1);
	});

	it("stops without reading history when disposed while waiting", async () => {
		const h = harness();
		h.store.m.set(SHARED_LAST_POSTED_KEY, String(h.clock.now()));
		const s = statics();
		const p = h.reg.sweepOwnedNotificationsAtStartup({
			notificationStatics: s,
			ownedTabIds: ["tab-a"],
			origin: ORIGIN,
		});
		await flush();
		h.reg.disposeNotifications();
		const result = await p;
		expect(result.ran).toBe(false);
		expect(s.getHistory).not.toHaveBeenCalled();
		expect(h.clock.pending()).toBe(0);
	});

	it("removes nothing when disposed while getHistory() is pending", async () => {
		const h = harness();
		let resolveHistory: (v: Array<{ id: string }>) => void = () => {};
		const s = statics({
			getHistory: () =>
				new Promise((res) => {
					resolveHistory = res;
				}),
		});
		const p = h.reg.sweepOwnedNotificationsAtStartup({
			notificationStatics: s,
			ownedTabIds: ["tab-a"],
			origin: ORIGIN,
		});
		await flush();
		h.reg.disposeNotifications();
		resolveHistory([{ id: idFor("tab-a:1") }]);
		await p;
		expect(s.remove).not.toHaveBeenCalled();
	});

	it("skips a history entry whose tag is live in the registry at removal time", async () => {
		const h = harness();
		const live = h.post("tab-a");
		h.clock.advance(Q);
		const s = statics({ getHistory: async () => [{ id: idFor(live.tag) }] });
		await h.reg.sweepOwnedNotificationsAtStartup({
			notificationStatics: s,
			ownedTabIds: ["tab-a"],
			origin: ORIGIN,
		});
		expect(s.remove.mock.calls.map((c) => c[0])).not.toContain(idFor(live.tag));
	});

	it("still removes reconstructed ids when getHistory rejects, and continues past a failed remove", async () => {
		const h = harness();
		const onError = vi.fn();
		const s = statics({
			getHistory: async () => {
				throw new Error("history boom");
			},
			remove: async (rid: string) => {
				if (rid === idFor("tab-a")) throw new Error("remove boom");
			},
		});
		const result = await h.reg.sweepOwnedNotificationsAtStartup({
			notificationStatics: s,
			ownedTabIds: ["tab-a", "tab-b"],
			origin: ORIGIN,
			onError,
		});
		expect(result.ran).toBe(true);
		expect(s.remove.mock.calls.map((c) => c[0])).toEqual(
			expect.arrayContaining([idFor("tab-a"), idFor("tab-b")]),
		);
		expect(onError).toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Module default instance
// ---------------------------------------------------------------------------

describe("module default instance", () => {
	let ctor: ReturnType<typeof makeCtor>;
	let clock: ReturnType<typeof makeClock>;

	beforeEach(() => {
		ctor = makeCtor();
		clock = makeClock();
		__resetNotificationRegistryForTests({
			NotificationCtor: () => ctor.Ctor,
			store: () => makeStore(),
			schedule: clock.schedule,
			cancel: clock.cancel,
			now: clock.now,
			raiseOwningWindow: () => {},
			log: () => {},
		});
	});

	it("resets in place: no disposed flag, no remover, no retained entries", () => {
		const remove = vi.fn();
		initNotifications({ statics: { remove }, origin: ORIGIN });
		showOwnedNotification({ owner: "tab-a", title: "x", options: {}, onClick: vi.fn() });
		disposeNotifications();

		const ctor2 = makeCtor();
		const clock2 = makeClock();
		__resetNotificationRegistryForTests({
			NotificationCtor: () => ctor2.Ctor,
			store: () => makeStore(),
			schedule: clock2.schedule,
			cancel: clock2.cancel,
			now: clock2.now,
			raiseOwningWindow: () => {},
			log: () => {},
		});
		expect(__getRetainedNotificationCountForTests()).toBe(0);
		showOwnedNotification({ owner: "tab-a", title: "x", options: {}, onClick: vi.fn() });
		showOwnedNotification({ owner: "tab-a", title: "x", options: {}, onClick: vi.fn() });
		expect(ctor2.made).toHaveLength(2);
		clock2.advance(Q);
		expect(remove).not.toHaveBeenCalled();
		expect(__getRetainedNotificationCountForTests()).toBe(2);
	});
});
