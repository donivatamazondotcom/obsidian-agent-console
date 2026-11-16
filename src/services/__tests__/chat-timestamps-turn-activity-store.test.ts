/**
 * Chat Timestamps PR 3: the per-panel store the ticker publishes to
 * (spec § Ticker and store). It notifies only when a string a leaf shows
 * changed, and `reset()` clears the live line and rows but never the
 * header total (PR 4).
 */
import { describe, expect, it, vi } from "vitest";
import { createTurnActivityStore } from "../turn-activity-store";

describe("createTurnActivityStore", () => {
	it("starts empty", () => {
		const store = createTurnActivityStore();
		expect(store.getSnapshot()).toEqual({ line: null, lineTitle: null, rows: {}, total: null });
	});

	it("notifies when the line or a row changes, and only then", () => {
		const store = createTurnActivityStore();
		const listener = vi.fn();
		store.subscribe(listener);

		store.publish({ line: "Working 1m · no update yet", rows: {} });
		expect(listener).toHaveBeenCalledTimes(1);
		const first = store.getSnapshot();

		store.publish({ line: "Working 1m · no update yet", rows: {} });
		expect(listener).toHaveBeenCalledTimes(1);
		expect(store.getSnapshot()).toBe(first);

		store.publish({ line: "Working 1m · no update yet", rows: { tc1: "5s" } });
		expect(listener).toHaveBeenCalledTimes(2);

		store.publish({ line: "Working 1m · no update yet", rows: { tc1: "6s" } });
		expect(listener).toHaveBeenCalledTimes(3);

		store.publish({ line: "Working 1m · no update yet", rows: { tc2: "6s" } });
		expect(listener).toHaveBeenCalledTimes(4);

		store.publish({ line: "Working 1m · no update yet", lineTitle: "Running: x", rows: { tc2: "6s" } });
		expect(listener).toHaveBeenCalledTimes(5);
	});

	it("reset clears the line and rows, keeps the total, and is quiet when already empty", () => {
		const store = createTurnActivityStore();
		const listener = vi.fn();
		store.subscribe(listener);
		store.publishTotal(24 * 60_000);
		store.publish({ line: "· 5m", lineTitle: "Running: npm test", rows: { tc1: "5m · output 2s ago" } });
		listener.mockClear();

		store.reset();
		expect(store.getSnapshot()).toEqual({ line: null, lineTitle: null, rows: {}, total: 24 * 60_000 });
		expect(listener).toHaveBeenCalledTimes(1);

		store.reset();
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("publishTotal notifies only on a change", () => {
		const store = createTurnActivityStore();
		const listener = vi.fn();
		store.subscribe(listener);
		store.publishTotal(1000);
		store.publishTotal(1000);
		store.publishTotal(null);
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("unsubscribes", () => {
		const store = createTurnActivityStore();
		const listener = vi.fn();
		const off = store.subscribe(listener);
		off();
		store.publish({ line: "x", rows: {} });
		expect(listener).not.toHaveBeenCalled();
	});
});
