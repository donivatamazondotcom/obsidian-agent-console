/**
 * Unit tests for the runtime profiler's pure core (Gate B-phase2):
 * metric deltas, the baseline tagged-union verdict, and heavy-session
 * generator determinism. No live Obsidian — these gate the logic a future
 * release gate would depend on.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2, GB-T04/T05.
 */
import { describe, it, expect } from "vitest";
import {
	computeDelta,
	toSnapshot,
	summarizeLongTasks,
	TRACKED_METRIC_KEYS,
} from "../metrics";
import {
	diffAgainstBaseline,
	type Baseline,
	type Profile,
} from "../baseline";
import {
	generateHeavySession,
	countCodeBlocks,
} from "../fixtures/heavy-session";

describe("metrics.toSnapshot", () => {
	it("flattens a getMetrics array into a name->value map", () => {
		const snap = toSnapshot([
			{ name: "LayoutCount", value: 10 },
			{ name: "ScriptDuration", value: 1.5 },
		]);
		expect(snap).toEqual({ LayoutCount: 10, ScriptDuration: 1.5 });
	});
	it("ignores malformed entries", () => {
		const snap = toSnapshot([
			{ name: "LayoutCount", value: 10 },
			// @ts-expect-error deliberately malformed
			{ name: "Bad", value: "x" },
			// @ts-expect-error deliberately malformed
			{ value: 5 },
		]);
		expect(snap).toEqual({ LayoutCount: 10 });
	});
});

describe("metrics.computeDelta", () => {
	it("subtracts after - before per tracked key", () => {
		const before = { LayoutCount: 482, RecalcStyleCount: 6021 };
		const after = { LayoutCount: 883, RecalcStyleCount: 6468 };
		const d = computeDelta(before, after);
		// Mirrors the live probe: 400 forced reflows -> +401 LayoutCount.
		expect(d.LayoutCount).toBe(401);
		expect(d.RecalcStyleCount).toBe(447);
	});
	it("treats a missing key as 0 on that side (no NaN)", () => {
		const d = computeDelta({}, { LayoutCount: 5 });
		expect(d.LayoutCount).toBe(5);
		expect(d.ScriptDuration).toBe(0);
		expect(Object.values(d).every((v) => Number.isFinite(v))).toBe(true);
	});
	it("honours a supplied key subset", () => {
		const d = computeDelta(
			{ LayoutCount: 1 },
			{ LayoutCount: 3 },
			["LayoutCount"],
		);
		expect(Object.keys(d)).toEqual(["LayoutCount"]);
	});
	it("covers every tracked key by default", () => {
		const d = computeDelta({}, {});
		expect(Object.keys(d).sort()).toEqual([...TRACKED_METRIC_KEYS].sort());
	});
});

describe("metrics.summarizeLongTasks", () => {
	it("counts only frames over the 50ms threshold and takes maxima", () => {
		const s = summarizeLongTasks([
			{ name: "long-animation-frame", duration: 80, blockingDuration: 30, styleAndLayoutDuration: 12 },
			{ name: "long-animation-frame", duration: 20, blockingDuration: 2, styleAndLayoutDuration: 40 },
			{ name: "longtask", duration: 60, blockingDuration: 55 },
		]);
		expect(s.longTaskCount).toBe(2); // 80 and 60, not 20
		expect(s.longTaskTotalMs).toBe(140);
		expect(s.maxBlockingMs).toBe(55);
		expect(s.maxStyleLayoutMs).toBe(40);
	});
	it("handles an empty buffer", () => {
		expect(summarizeLongTasks([])).toEqual({
			longTaskCount: 0,
			longTaskTotalMs: 0,
			maxBlockingMs: 0,
			maxStyleLayoutMs: 0,
		});
	});
});

describe("baseline.diffAgainstBaseline", () => {
	const baseline: Baseline = {
		thresholdPct: 0.1,
		capturedAt: "2026-07-01T00:00:00.000Z",
		scenarios: {
			"cold-start": { LayoutCount: 100, ScriptDuration: 1.0 },
		},
	};

	it("returns no-baseline when baseline is missing or empty", () => {
		expect(diffAgainstBaseline({}, null).kind).toBe("no-baseline");
		expect(
			diffAgainstBaseline({}, {
				thresholdPct: 0.1,
				capturedAt: "x",
				scenarios: {},
			}).kind,
		).toBe("no-baseline");
	});

	it("returns no-baseline when no metrics overlap", () => {
		const profile: Profile = { "other-scenario": { LayoutCount: 999 } };
		expect(diffAgainstBaseline(profile, baseline).kind).toBe("no-baseline");
	});

	it("flags a regression past threshold with offenders", () => {
		const profile: Profile = {
			"cold-start": { LayoutCount: 130, ScriptDuration: 1.0 },
		};
		const v = diffAgainstBaseline(profile, baseline);
		expect(v.kind).toBe("regression");
		if (v.kind === "regression") {
			expect(v.offenders).toHaveLength(1);
			expect(v.offenders[0].metric).toBe("LayoutCount");
			expect(v.offenders[0].pctChange).toBeCloseTo(0.3, 5);
		}
	});

	it("passes when within threshold", () => {
		const profile: Profile = {
			"cold-start": { LayoutCount: 105, ScriptDuration: 1.02 },
		};
		const v = diffAgainstBaseline(profile, baseline);
		expect(v.kind).toBe("ok");
	});

	it("reports an improvement when the largest change is a big drop", () => {
		const profile: Profile = {
			"cold-start": { LayoutCount: 50, ScriptDuration: 0.5 },
		};
		const v = diffAgainstBaseline(profile, baseline);
		expect(v.kind).toBe("improvement");
	});

	it("exempts sub-floor metrics from the pct gate", () => {
		const b: Baseline = {
			thresholdPct: 0.1,
			capturedAt: "x",
			scenarios: { s: { LayoutDuration: 0.0001 } },
			floors: { LayoutDuration: 0.005 },
		};
		// 0.0001 -> 0.0003 is +200% but both are below the 0.005 floor.
		const v = diffAgainstBaseline({ s: { LayoutDuration: 0.0003 } }, b);
		expect(v.kind).toBe("no-baseline"); // the only metric was floored out
	});

	it("never throws on malformed measured values", () => {
		const profile = {
			"cold-start": { LayoutCount: NaN, ScriptDuration: 1.0 },
		} as unknown as Profile;
		expect(() => diffAgainstBaseline(profile, baseline)).not.toThrow();
	});

	it("skips gate-excluded metrics (JSHeapUsedSize by default)", () => {
		const b: Baseline = {
			thresholdPct: 0.1,
			capturedAt: "x",
			scenarios: { s: { JSHeapUsedSize: 1_000_000, LayoutCount: 100 } },
		};
		// Heap doubled (huge %) but excluded by default; LayoutCount within threshold.
		const v = diffAgainstBaseline(
			{ s: { JSHeapUsedSize: 2_000_000, LayoutCount: 105 } },
			b,
		);
		expect(v.kind).toBe("ok");
	});

	it("honours a custom gateExclude list", () => {
		const b: Baseline = {
			thresholdPct: 0.1,
			capturedAt: "x",
			scenarios: { s: { LayoutCount: 100 } },
			gateExclude: ["LayoutCount"],
		};
		// The only metric is excluded, so there is nothing left to compare.
		const v = diffAgainstBaseline({ s: { LayoutCount: 500 } }, b);
		expect(v.kind).toBe("no-baseline");
	});
});

describe("fixtures.generateHeavySession", () => {
	it("is byte-for-byte deterministic across runs", () => {
		const a = generateHeavySession();
		const b = generateHeavySession();
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	});
	it("produces exactly 201 messages and 56 code blocks by default", () => {
		const s = generateHeavySession();
		expect(s.messages).toHaveLength(201);
		expect(countCodeBlocks(s)).toBe(56);
	});
	it("alternates user/assistant starting with user", () => {
		const s = generateHeavySession();
		expect(s.messages[0].role).toBe("user");
		expect(s.messages[1].role).toBe("assistant");
	});
	it("changes content with a different seed but keeps the shape", () => {
		const a = generateHeavySession({ seed: 1 });
		const b = generateHeavySession({ seed: 2 });
		expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
		expect(a.messages).toHaveLength(201);
		expect(b.messages).toHaveLength(201);
		expect(countCodeBlocks(a)).toBe(56);
		expect(countCodeBlocks(b)).toBe(56);
	});
	it("respects custom counts", () => {
		const s = generateHeavySession({ messageCount: 21, codeBlockCount: 5 });
		expect(s.messages).toHaveLength(21);
		expect(countCodeBlocks(s)).toBe(5);
		expect(s.version).toBe(1);
	});
});
