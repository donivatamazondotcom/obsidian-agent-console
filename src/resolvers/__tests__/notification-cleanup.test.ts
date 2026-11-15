/**
 * I52 round 9: the pure decision behind the notification cleanup pass.
 *
 * Root cause (probes 2026-11-13/14): removing a delivered notification shortly
 * after another one is posted makes the newer notification lose its click when
 * the user clicks it from Notification Center after about a minute. So no
 * removal may run until an app-wide quiet period has passed since the latest
 * posting (B3 probe: +60 s was safe; B′: +5 s was not).
 */
import { describe, it, expect } from "vitest";
import {
	decideNotificationCleanup,
	clampDelay,
	parseSharedTimestamp,
	type CleanupEntry,
} from "../notification-cleanup";

const QUIET = 60_000;
const NOW = 10_000_000;

function entry(
	tag: string,
	owner: string,
	extra: Partial<CleanupEntry> = {},
): CleanupEntry {
	return { tag, owner, orphaned: false, failedRemovals: 0, pending: false, ...extra };
}

function decide(entries: CleanupEntry[], lastPostedAt: number, cap = 10) {
	return decideNotificationCleanup({
		entries,
		now: NOW,
		effectiveLastPostedAt: lastPostedAt,
		quietMs: QUIET,
		cap,
		maxRetries: 3,
	});
}

describe("decideNotificationCleanup (I52 round 9)", () => {
	it("defers until QUIET_MS after the latest posting, with the remaining delay", () => {
		const d = decide([entry("a:1", "a"), entry("a:2", "a")], NOW - 20_000);
		expect(d).toEqual({ kind: "defer", delayMs: 40_000 });
	});

	it("runs exactly at the quiet boundary", () => {
		const d = decide([entry("a:1", "a"), entry("a:2", "a")], NOW - QUIET);
		expect(d.kind).toBe("run");
	});

	it("removes every superseded entry of an owner and keeps its newest (insertion order)", () => {
		const d = decide(
			[entry("a:1", "a"), entry("b:1", "b"), entry("a:2", "a"), entry("a:3", "a")],
			NOW - QUIET,
		);
		expect(d).toEqual({ kind: "run", remove: ["a:1", "a:2"], evict: [] });
	});

	it("removes orphaned entries even when they are an owner's newest", () => {
		const d = decide(
			[entry("a:1", "a", { orphaned: true }), entry("b:1", "b")],
			NOW - QUIET,
		);
		expect(d).toEqual({ kind: "run", remove: ["a:1"], evict: [] });
	});

	it("skips entries that exhausted their removal retries or have a removal pending", () => {
		const d = decide(
			[
				entry("a:1", "a", { failedRemovals: 3 }),
				entry("a:2", "a", { pending: true }),
				entry("a:3", "a"),
			],
			NOW - QUIET,
		);
		expect(d).toEqual({ kind: "run", remove: [], evict: [] });
	});

	it("evicts the oldest remaining entries down to the cap (soft cap after a burst)", () => {
		const burst = Array.from({ length: 12 }, (_, i) => entry(`t${i}:1`, `t${i}`));
		const d = decide(burst, NOW - QUIET);
		expect(d).toEqual({ kind: "run", remove: [], evict: ["t0:1", "t1:1"] });
	});

	it("does not count entries it is already removing against the cap", () => {
		const entries = [
			entry("a:1", "a"),
			...Array.from({ length: 10 }, (_, i) => entry(`t${i}:1`, `t${i}`)),
			entry("a:2", "a"),
		];
		const d = decide(entries, NOW - QUIET);
		// a:1 is superseded; the 11 kept entries exceed the cap by one.
		expect(d).toEqual({ kind: "run", remove: ["a:1"], evict: ["t0:1"] });
	});

	it("S1: a busy tab's burst never evicts idle tabs' only notifications", () => {
		const entries = [
			entry("b:1", "b"),
			entry("c:1", "c"),
			entry("d:1", "d"),
			...Array.from({ length: 12 }, (_, i) => entry(`a:${i + 1}`, "a")),
		];
		const d = decide(entries, NOW - QUIET);
		expect(d).toEqual({
			kind: "run",
			remove: Array.from({ length: 11 }, (_, i) => `a:${i + 1}`),
			evict: [],
		});
	});

	it("S2: an orphaned entry is removed and only the overflow is evicted", () => {
		const entries = [
			...Array.from({ length: 10 }, (_, i) => entry(`t${i}:1`, `t${i}`)),
			entry("x:1", "x", { orphaned: true }),
			entry("y:1", "y"),
		];
		const d = decide(entries, NOW - QUIET);
		expect(d).toEqual({ kind: "run", remove: ["x:1"], evict: ["t0:1"] });
	});

	it("S3: stale entries that cannot be removed are evicted before a live one (no-remover host)", () => {
		const entries = [
			entry("b:1", "b"),
			...Array.from({ length: 9 }, (_, i) =>
				entry(`a:${i + 1}`, "a", { failedRemovals: 3 }),
			),
			entry("a:10", "a"),
		];
		const d = decide(entries, NOW - QUIET);
		expect(d).toEqual({ kind: "run", remove: [], evict: ["a:1"] });
	});

	it("removes nothing and only evicts when retries are disabled (maxRetries 0)", () => {
		const entries = [
			entry("b:1", "b"),
			...Array.from({ length: 10 }, (_, i) => entry(`a:${i + 1}`, "a")),
		];
		const d = decideNotificationCleanup({
			entries,
			now: NOW,
			effectiveLastPostedAt: NOW - QUIET,
			quietMs: QUIET,
			cap: 10,
			maxRetries: 0,
		});
		// Stale a:1 goes before live b:1.
		expect(d).toEqual({ kind: "run", remove: [], evict: ["a:1"] });
	});

	it("an entry whose removals are exhausted still falls to the cap", () => {
		const entries = [
			entry("a:1", "a", { failedRemovals: 3 }),
			...Array.from({ length: 10 }, (_, i) => entry(`t${i}:1`, `t${i}`)),
		];
		const d = decide(entries, NOW - QUIET);
		expect(d).toEqual({ kind: "run", remove: [], evict: ["a:1"] });
	});

	it("never evicts an entry with a removal in flight", () => {
		const entries = [
			entry("a:1", "a", { pending: true }),
			...Array.from({ length: 10 }, (_, i) => entry(`t${i}:1`, `t${i}`)),
		];
		const d = decide(entries, NOW - QUIET);
		expect(d).toEqual({ kind: "run", remove: [], evict: ["t0:1"] });
	});

	it("runs with nothing to do when there is no posting at all", () => {
		const d = decide([entry("a:1", "a")], -Infinity);
		expect(d).toEqual({ kind: "run", remove: [], evict: [] });
	});

	it("clamps a defer delay to QUIET_MS when the latest posting is in the future", () => {
		const d = decide([entry("a:1", "a")], NOW + 45_000);
		expect(d).toEqual({ kind: "defer", delayMs: QUIET });
	});
});

describe("clampDelay", () => {
	it.each([
		[-5, 0],
		[0, 0],
		[1_234, 1_234],
		[QUIET, QUIET],
		[QUIET + 1, QUIET],
		[Number.POSITIVE_INFINITY, QUIET],
		[Number.NEGATIVE_INFINITY, 0],
		[Number.NaN, 0],
	])("clampDelay(%s) -> %s", (input, expected) => {
		expect(clampDelay(input, QUIET)).toBe(expected);
	});
});

describe("parseSharedTimestamp (shared quiet clock trust boundary)", () => {
	it.each([
		["a valid past value", String(NOW - 5_000), NOW - 5_000],
		["a value slightly in the future", String(NOW + 30_000), NOW + 30_000],
		["a missing key", null, null],
		["undefined", undefined, null],
		["Infinity", "Infinity", null],
		["-Infinity", "-Infinity", null],
		["NaN text", "abc", null],
		["a value more than QUIET_MS in the future", String(NOW + QUIET + 1), null],
	])("%s", (_label, raw, expected) => {
		expect(parseSharedTimestamp(raw as string | null | undefined, NOW, QUIET)).toBe(
			expected,
		);
	});
});
