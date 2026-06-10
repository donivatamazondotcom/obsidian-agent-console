/**
 * BM-T01, BM-T03, BM-T04, BM-T05 — context-efficiency harness behavior.
 *
 * Spec: [[Agent Console Token Efficiency Benchmark]] § Test Cases.
 */
import { describe, it, expect } from "vitest";
import { b0Timed, b1Timed, hydTimed } from "../../../tools/benchmark/strategies";
import {
	SCENARIOS,
	runScenario,
	simulate,
	percentLower,
	dollarCostB0,
	type StrategyDeps,
} from "../../../tools/benchmark/scenarios";
import {
	createEncoder,
	serializeBlock,
	type CountableBlock,
} from "../../../tools/benchmark/token-accounting";

const enc = createEncoder();
const countBlock = (b: CountableBlock): number => enc(serializeBlock(b));
const deps: StrategyDeps = { b0Timed, b1Timed, hydTimed, countBlock };

const s1 = () => SCENARIOS.find((s) => s.id === "S1")!;
const s5 = () => SCENARIOS.find((s) => s.id === "S5")!;

describe("BM-T01: harness reproduces the v0 analytical model", () => {
	it("HYD vs B0 ≈ 75% at K=8, C=1500 (chars/4 model)", () => {
		const m = simulate(8, 1500);
		expect(percentLower(m.b0, m.hyd)).toBeGreaterThan(74);
		expect(percentLower(m.b0, m.hyd)).toBeLessThan(76);
	});

	it("B1 vs B0 lands in the ~75-85% band (model)", () => {
		const m = simulate(8, 1500);
		const b1 = percentLower(m.b0, m.b1);
		expect(b1).toBeGreaterThan(75);
		expect(b1).toBeLessThan(85);
	});
});

describe("BM-T03: headline scenario lands in the expected band", () => {
	it("S1 B1-vs-B0 and HYD-vs-B0 are 70-85% (real tokenizer)", () => {
		const r = runScenario(s1(), deps);
		expect(r.headline).toBe(true);
		expect(r.b1VsB0).toBeGreaterThan(70);
		expect(r.b1VsB0).toBeLessThan(85);
		expect(r.hydVsB0).not.toBeNull();
		expect(r.hydVsB0!).toBeGreaterThan(70);
		expect(r.hydVsB0!).toBeLessThan(85);
	});
});

describe("BM-T04: never-read scenario is reported, not hidden", () => {
	it("S5 exists in the matrix and shows HYD worse than B1", () => {
		expect(SCENARIOS.some((s) => s.id === "S5")).toBe(true);
		const r = runScenario(s5(), deps);
		// Honesty guard: front-loaded hydration loses when the note is never read.
		expect(r.hydVsB1).not.toBeNull();
		expect(r.hydVsB1!).toBeLessThan(0);
		// And B1 still beats B0 even with no read (refs only).
		expect(r.b1VsB0).toBeGreaterThan(0);
	});
});

describe("BM-T05: dollar-cost computed separately, smaller than window delta", () => {
	it("$ delta < context-window delta, and B1 still cheaper", () => {
		const scenario = s1();
		const r = runScenario(scenario, deps);
		const b0Dollar = dollarCostB0(
			b0Timed(scenario.notes, scenario.K),
			scenario.K,
			countBlock,
			0.1,
		);
		const dollarDelta = percentLower(b0Dollar, r.b1);
		// Caching softens B0's repeats → the $ saving is smaller than the
		// raw context-window saving, but B1 is still cheaper (delta > 0).
		expect(dollarDelta).toBeGreaterThan(0);
		expect(dollarDelta).toBeLessThan(r.b1VsB0);
	});
});
