/**
 * Baseline diff for the runtime profiler (Gate B-phase2).
 *
 * Pure and importable by design: a FUTURE gate step can `import
 * { diffAgainstBaseline }` and branch on the tagged-union {@link Verdict}
 * with none of the profiler's live-Obsidian machinery. Promoting the
 * profiler to a release gate is therefore a one-line addition (call this,
 * fail on `kind === "regression"`) — no refactor. Until then the profiler
 * runs standalone and this verdict only drives console output + the
 * optional `--gate` exit code.
 *
 * Direction convention: HIGHER IS WORSE for every profiled metric (layout
 * counts, style recalcs, durations, heap, long-task totals), so a
 * regression is any metric that rose beyond the threshold vs baseline.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2, Decision QG6.
 */

/** A per-scenario map of metric-name -> measured value. */
export type ScenarioMetrics = Record<string, number>;
/** The full profile: scenarioId -> its metrics. */
export type Profile = Record<string, ScenarioMetrics>;

export interface Baseline {
	/** Regression threshold as a fraction (0.1 = +10%). */
	thresholdPct: number;
	/** ISO timestamp the baseline was captured / ratcheted. */
	capturedAt: string;
	/** scenarioId -> metric -> baseline value. */
	scenarios: Profile;
	/**
	 * Per-metric noise floors. A metric whose baseline AND measured value
	 * are both below its floor is exempt from the pct gate, so a
	 * 0.0001s -> 0.0003s swing is not reported as a "200% regression".
	 */
	floors?: Record<string, number>;
	/**
	 * Metrics excluded from gating entirely (informational only). Heap size
	 * is GC-dependent and swings unboundedly run-to-run (GB-T05), so it is
	 * excluded by default via {@link DEFAULT_GATE_EXCLUDE}.
	 */
	gateExclude?: string[];
}

export interface Offender {
	scenario: string;
	metric: string;
	baseline: number;
	measured: number;
	/** Fractional change (0.2 = +20%). */
	pctChange: number;
}

/** Total, never-throwing verdict. Tagged union — illegal combos unrepresentable. */
export type Verdict =
	| { kind: "ok"; maxPctChange: number }
	| { kind: "improvement"; maxPctDrop: number }
	| { kind: "regression"; offenders: Offender[] }
	| { kind: "no-baseline" };

/**
 * Default per-metric noise floors. Durations are in seconds (CDP
 * convention); long-task fields are in ms. Below these, pct swings are
 * dominated by jitter and must not gate.
 */
export const DEFAULT_FLOORS: Record<string, number> = {
	// Sub-100ms durations are below the reliable-measurement floor in a live
	// Obsidian — they jitter ±50% run-to-run (GB-T05), so floor them out of
	// gating and let the counts + wallMs carry the signal.
	LayoutDuration: 0.1,
	RecalcStyleDuration: 0.1,
	ScriptDuration: 0.1,
	TaskDuration: 0.1,
	longTaskTotalMs: 50,
	maxBlockingMs: 20,
	maxStyleLayoutMs: 10,
	wallMs: 30,
};

/**
 * Metrics never gated on — GC-dependent or otherwise too noisy to block a
 * release (GB-T05). Reported in the profile table but skipped by the diff.
 */
export const DEFAULT_GATE_EXCLUDE: readonly string[] = ["JSHeapUsedSize"];

function round4(n: number): number {
	return Math.round(n * 1e4) / 1e4;
}

/**
 * Diff a measured profile against a baseline. A regression is any metric
 * that rose beyond `(1 + threshold) * baseline`, ignoring metrics below
 * their noise floor. Returns:
 *  - `no-baseline` when there is nothing to compare against,
 *  - `regression` with the offending metrics,
 *  - `improvement` when the largest change is a drop beyond threshold,
 *  - `ok` otherwise (with the largest observed pct change).
 *
 * Total function — never throws, even on malformed input.
 */
export function diffAgainstBaseline(
	profile: Profile,
	baseline: Baseline | null | undefined,
	thresholdPct?: number,
): Verdict {
	if (!baseline || Object.keys(baseline.scenarios ?? {}).length === 0) {
		return { kind: "no-baseline" };
	}
	const threshold = thresholdPct ?? baseline.thresholdPct;
	const floors = { ...DEFAULT_FLOORS, ...(baseline.floors ?? {}) };
	const exclude = new Set([
		...DEFAULT_GATE_EXCLUDE,
		...(baseline.gateExclude ?? []),
	]);
	const offenders: Offender[] = [];
	let sawComparison = false;
	let maxPctChange = 0;
	let maxPctDrop = 0;

	for (const [scenario, baseMetrics] of Object.entries(baseline.scenarios)) {
		const measured = profile[scenario];
		if (!measured) continue;
		for (const [metric, baseVal] of Object.entries(baseMetrics)) {
			if (exclude.has(metric)) continue;
			const measuredVal = measured[metric];
			if (typeof measuredVal !== "number" || !Number.isFinite(measuredVal)) {
				continue;
			}
			if (typeof baseVal !== "number" || !Number.isFinite(baseVal)) continue;
			const floor = floors[metric] ?? 0;
			if (Math.abs(baseVal) < floor && Math.abs(measuredVal) < floor) {
				continue;
			}
			// When the baseline is sub-floor, measure the pct rise against the
			// floor rather than a tiny denominator (avoids divide-by-near-zero).
			const denom = Math.abs(baseVal) < floor ? floor : Math.abs(baseVal);
			const pct = denom === 0 ? 0 : (measuredVal - baseVal) / denom;
			sawComparison = true;
			maxPctChange = Math.max(maxPctChange, pct);
			maxPctDrop = Math.min(maxPctDrop, pct);
			if (pct > threshold) {
				offenders.push({
					scenario,
					metric,
					baseline: baseVal,
					measured: measuredVal,
					pctChange: round4(pct),
				});
			}
		}
	}

	if (!sawComparison) return { kind: "no-baseline" };
	if (offenders.length > 0) return { kind: "regression", offenders };
	if (maxPctDrop < -threshold) {
		return { kind: "improvement", maxPctDrop: round4(maxPctDrop) };
	}
	return { kind: "ok", maxPctChange: round4(maxPctChange) };
}
