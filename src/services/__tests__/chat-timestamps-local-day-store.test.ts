/**
 * Chat Timestamps PR 2 — the plugin's one day store.
 *
 * Every view and popout reads one store, so they agree on the local day and
 * the time zone (Decision 7). Asserted at its public API with fake timers and a
 * pinned zone; a zone change is driven by assigning `process.env.TZ`, which
 * moves `Date` and fresh formatters exactly the way an OS zone change does.
 *
 * Spec: [[Agent Console Chat Timestamps]] § Ticker and store (the day store).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createLocalDayStore } from "../local-day-store";

let savedTz: string | undefined;
beforeAll(() => {
	savedTz = process.env.TZ;
});
afterAll(() => {
	if (savedTz === undefined) delete process.env.TZ;
	else process.env.TZ = savedTz;
});
beforeEach(() => {
	process.env.TZ = "America/Los_Angeles";
	vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
});
afterEach(() => {
	vi.useRealTimers();
});

const local = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) =>
	new Date(y, mo - 1, d, h, mi, s).getTime();

function freshZone(): string | undefined {
	return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** A window and document that record their listeners, like a popout's. */
function fakeHost() {
	const win = new EventTarget() as unknown as Window;
	const doc = new EventTarget() as unknown as Document;
	return { win, doc };
}

describe("snapshot", () => {
	it("is built lazily from the time of the first read", () => {
		const store = createLocalDayStore();
		vi.setSystemTime(local(2026, 11, 15, 9));
		expect(store.getSnapshot().bounds.dayStart).toBe(local(2026, 11, 15));
		expect(store.getSnapshot().zone).toBe(freshZone());
	});

	it("keeps its identity until the day or the zone changes", () => {
		const store = createLocalDayStore();
		vi.setSystemTime(local(2026, 11, 15, 9));
		const first = store.getSnapshot();
		expect(store.recheckIfStale(Date.now())).toBe(first);
		expect(store.recheck(Date.now())).toBe(first);
		vi.setSystemTime(local(2026, 11, 16, 0, 0, 1));
		const next = store.recheckIfStale(Date.now());
		expect(next).not.toBe(first);
		expect(next.bounds.dayStart).toBe(local(2026, 11, 16));
		expect(store.getSnapshot()).toBe(next);
	});

	it("a clock set back past midnight is corrected", () => {
		const store = createLocalDayStore();
		vi.setSystemTime(local(2026, 11, 15, 0, 5));
		store.getSnapshot();
		vi.setSystemTime(local(2026, 11, 14, 23, 55));
		expect(store.recheckIfStale(Date.now()).bounds.dayStart).toBe(local(2026, 11, 14));
	});

	it("follows a zone change on recheck, and notifies once", () => {
		const store = createLocalDayStore();
		vi.setSystemTime(Date.UTC(2026, 10, 15, 17));
		const first = store.getSnapshot();
		const notified = vi.fn();
		store.subscribe(notified);
		process.env.TZ = "Asia/Kolkata";
		const next = store.recheck(Date.now());
		expect(next.zone).toBe(freshZone());
		expect(next.zone).not.toBe(first.zone);
		expect(store.recheck(Date.now())).toBe(next);
		expect(notified).toHaveBeenCalledTimes(1);
	});
});

describe("midnight timeout", () => {
	it("bumps the day at midnight in an idle view", () => {
		const store = createLocalDayStore();
		vi.setSystemTime(local(2026, 11, 15, 23, 58));
		const { win, doc } = fakeHost();
		const unregister = store.register(win, doc);
		const notified = vi.fn();
		store.subscribe(notified);
		vi.advanceTimersByTime(3 * 60_000);
		expect(store.getSnapshot().bounds.dayStart).toBe(local(2026, 11, 16));
		expect(notified).toHaveBeenCalledTimes(1);
		unregister();
	});

	it("a timer that fires early leaves the next one pending", () => {
		const store = createLocalDayStore();
		vi.setSystemTime(local(2026, 11, 15, 23, 0));
		const { win, doc } = fakeHost();
		const unregister = store.register(win, doc);
		// The wall clock jumps forward under the timer: when the timer fires,
		// it reads 50 ms before midnight.
		const delay = local(2026, 11, 16) - Date.now() + 1_000;
		vi.advanceTimersByTime(delay - 1);
		vi.setSystemTime(local(2026, 11, 16) - 50);
		vi.advanceTimersByTime(1);
		expect(store.getSnapshot().bounds.dayStart).toBe(local(2026, 11, 15));
		expect(vi.getTimerCount()).toBe(1);
		vi.advanceTimersByTime(2_000);
		expect(store.getSnapshot().bounds.dayStart).toBe(local(2026, 11, 16));
		unregister();
	});

	it("there is one timer however many views register, and none after the last leaves", () => {
		const store = createLocalDayStore();
		vi.setSystemTime(local(2026, 11, 15, 9));
		const a = fakeHost();
		const b = fakeHost();
		const offA = store.register(a.win, a.doc);
		const offB = store.register(b.win, b.doc);
		expect(vi.getTimerCount()).toBe(1);
		offA();
		expect(vi.getTimerCount()).toBe(1);
		offB();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("a re-check with no view registered starts no timer", () => {
		const store = createLocalDayStore();
		vi.setSystemTime(local(2026, 11, 15, 9));
		store.getSnapshot();
		vi.setSystemTime(local(2026, 11, 16, 9));
		store.recheck(Date.now());
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("registration", () => {
	it("a popout re-checks on its own window's focus and document's visibility", () => {
		const store = createLocalDayStore();
		vi.setSystemTime(local(2026, 11, 15, 9));
		const main = fakeHost();
		const popout = fakeHost();
		const offMain = store.register(main.win, main.doc);
		const offPopout = store.register(popout.win, popout.doc);
		vi.setSystemTime(local(2026, 11, 16, 9));
		popout.win.dispatchEvent(new Event("focus"));
		expect(store.getSnapshot().bounds.dayStart).toBe(local(2026, 11, 16));
		vi.setSystemTime(local(2026, 11, 17, 9));
		popout.doc.dispatchEvent(new Event("visibilitychange"));
		expect(store.getSnapshot().bounds.dayStart).toBe(local(2026, 11, 17));
		offMain();
		offPopout();
	});

	it("unregister removes only that view's listeners", () => {
		const store = createLocalDayStore();
		vi.setSystemTime(local(2026, 11, 15, 9));
		const a = fakeHost();
		const b = fakeHost();
		const offA = store.register(a.win, a.doc);
		const offB = store.register(b.win, b.doc);
		offA();
		vi.setSystemTime(local(2026, 11, 16, 9));
		a.win.dispatchEvent(new Event("focus"));
		expect(store.getSnapshot().bounds.dayStart).toBe(local(2026, 11, 15));
		b.win.dispatchEvent(new Event("focus"));
		expect(store.getSnapshot().bounds.dayStart).toBe(local(2026, 11, 16));
		offB();
	});

	it("dispose clears the timer and every listener", () => {
		const store = createLocalDayStore();
		vi.setSystemTime(local(2026, 11, 15, 9));
		const a = fakeHost();
		store.register(a.win, a.doc);
		store.dispose();
		expect(vi.getTimerCount()).toBe(0);
		vi.setSystemTime(local(2026, 11, 16, 9));
		const before = store.getSnapshot();
		a.win.dispatchEvent(new Event("focus"));
		expect(store.getSnapshot()).toBe(before);
	});
});
