/**
 * Unit tests for the runtime profiler's over-time tracking (Gate B-phase2):
 * median-of-N aggregation, JSONL history round-trip, and trend formatting.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2, QG7.
 */
import { describe, it, expect } from "vitest";
import {
	median,
	medianProfile,
	parseHistory,
	serializeEntry,
	formatTrend,
	type HistoryEntry,
} from "../history";
import type { Profile } from "../baseline";

describe("history.median", () => {
	it("returns the middle of an odd-length set", () => {
		expect(median([3, 1, 2])).toBe(2);
	});
	it("averages the middle two of an even-length set", () => {
		expect(median([1, 2, 3, 4])).toBe(2.5);
	});
	it("handles single and empty", () => {
		expect(median([7])).toBe(7);
		expect(median([])).toBe(0);
	});
	it("ignores non-finite values", () => {
		expect(median([1, NaN, 3])).toBe(2);
	});
});

describe("history.medianProfile", () => {
	it("medians each metric per scenario across runs", () => {
		const runs: Profile[] = [
			{ s: { wallMs: 200, LayoutCount: 1 } },
			{ s: { wallMs: 260, LayoutCount: 1 } },
			{ s: { wallMs: 240, LayoutCount: 1 } },
		];
		const m = medianProfile(runs);
		expect(m.s.wallMs).toBe(240);
		expect(m.s.LayoutCount).toBe(1);
	});
	it("survives a scenario missing from some runs", () => {
		const runs: Profile[] = [
			{ s: { wallMs: 100 }, t: { x: 5 } },
			{ s: { wallMs: 200 } }, // t failed this pass
		];
		const m = medianProfile(runs);
		expect(m.s.wallMs).toBe(150);
		expect(m.t.x).toBe(5); // medianed over the one run that had it
	});
});

describe("history JSONL round-trip", () => {
	const entry: HistoryEntry = {
		date: "2026-07-01",
		gitSha: "bead127",
		appVersion: "2.0.0",
		host: "test-host",
		medianOf: 5,
		scenarios: { "cold-start-restore": { wallMs: 248, longTaskCount: 4 } },
	};

	it("serializes and re-parses a single entry", () => {
		const line = serializeEntry(entry);
		const parsed = parseHistory(line);
		expect(parsed).toHaveLength(1);
		expect(parsed[0]).toEqual(entry);
	});
	it("parses multi-line JSONL and skips blank/corrupt lines", () => {
		const text = [
			serializeEntry(entry),
			"",
			"{ not valid json",
			serializeEntry({ ...entry, appVersion: "2.0.1" }),
		].join("\n");
		const parsed = parseHistory(text);
		expect(parsed).toHaveLength(2);
		expect(parsed[1].appVersion).toBe("2.0.1");
	});
	it("returns empty for empty input", () => {
		expect(parseHistory("")).toEqual([]);
	});
});

describe("history.formatTrend", () => {
	const entries: HistoryEntry[] = [
		{
			date: "2026-06-01",
			gitSha: "a",
			appVersion: "1.1.5",
			host: "h",
			medianOf: 5,
			scenarios: { "cold-start-restore": { wallMs: 231 } },
		},
		{
			date: "2026-07-01",
			gitSha: "b",
			appVersion: "2.0.0",
			host: "h",
			medianOf: 5,
			scenarios: { "cold-start-restore": { wallMs: 248 } },
		},
	];

	it("formats a rising series with a percent delta", () => {
		const t = formatTrend(entries, "cold-start-restore", "wallMs");
		expect(t).toBe("1.1.5 231 -> 2.0.0 248 (+7.4% over 2 pts)");
	});
	it("marks a single point flat", () => {
		const t = formatTrend([entries[0]], "cold-start-restore", "wallMs");
		expect(t).toBe("1.1.5 231 (flat)");
	});
	it("returns null when the metric never appears", () => {
		expect(formatTrend(entries, "cold-start-restore", "nope")).toBeNull();
		expect(formatTrend(entries, "no-scenario", "wallMs")).toBeNull();
	});
});
