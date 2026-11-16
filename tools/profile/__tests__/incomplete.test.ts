/**
 * The run-level decision that gates every write: any reason => nothing is
 * recorded or written.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2.
 */
import { describe, it, expect } from "vitest";
import { incompleteReasons, type RunFacts } from "../incomplete";

const base = (): RunFacts => ({
	profile: { a: { LayoutCount: 1 } },
	baseline: { thresholdPct: 0.3, capturedAt: "x", scenarios: { a: { LayoutCount: 1 } } },
	known: ["a"],
	failures: [],
	visibility: ["visible", "visible"],
	buildHashBefore: "h1",
	buildHashAfter: "h1",
});

describe("incompleteReasons", () => {
	it("is empty for a complete, visible, stable run", () => {
		expect(incompleteReasons(base())).toEqual([]);
	});

	it("flags a failed scenario in any pass", () => {
		const f = base();
		f.failures = [{ pass: 3, scenario: "a", error: "boom" }];
		expect(incompleteReasons(f)).toEqual(["pass 3: a failed — boom"]);
	});

	it("flags a hidden page, a changed main.js and an unmeasured baseline scenario", () => {
		const f = base();
		f.visibility = ["visible", "hidden"];
		f.buildHashAfter = "h2";
		f.profile = {};
		const r = incompleteReasons(f);
		expect(r).toHaveLength(3);
		expect(r[0]).toMatch(/hidden/);
		expect(r[1]).toMatch(/h1 -> h2/);
		expect(r[2]).toMatch(/a: in the baseline but not measured/);
	});

	it("does not flag a retired baseline scenario", () => {
		const f = base();
		f.baseline = { thresholdPct: 0.3, capturedAt: "x", scenarios: { a: { LayoutCount: 1 }, gone: { LayoutCount: 1 } } };
		expect(incompleteReasons(f)).toEqual([]);
	});
});
