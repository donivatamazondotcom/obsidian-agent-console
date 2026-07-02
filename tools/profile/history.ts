/**
 * Over-time tracking for the runtime profiler (Gate B-phase2).
 *
 * Pure + importable: median-of-N aggregation, append-only history
 * (JSONL) parsing/serialization, and trend formatting. No live Obsidian,
 * no fs — the orchestrator (`run-profile.ts`) owns reading/writing the
 * `profile-history.jsonl` file; everything here is deterministic and
 * unit-tested in `__tests__/history.test.ts`.
 *
 * Why a history file rather than just a ratcheting baseline: ratcheting
 * hides slow compounding drift (each release within threshold, ten
 * releases silently doubled). The history + an immutable golden anchor
 * give the "trend" half of the spec's "floor + trend" model.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2, QG7.
 */
import type { Profile, ScenarioMetrics } from "./baseline";

/** One recorded point in the time series. Same-machine by construction. */
export interface HistoryEntry {
	/** ISO date (YYYY-MM-DD) the point was recorded. */
	date: string;
	/** Short git SHA of the PLUGIN build under test (main checkout HEAD). */
	gitSha: string;
	/** Plugin version from manifest.json. */
	appVersion: string;
	/** Hostname — trend comparability requires the same machine. */
	host: string;
	/** N in median-of-N (how many passes this point aggregates). */
	medianOf: number;
	/** Per-scenario median metrics. */
	scenarios: Profile;
}

/**
 * The stable, trend-worthy metrics per scenario (GB-T05). Durations and
 * heap are excluded — too jittery to trend. These are what `--trend` shows
 * and what a future drift gate would watch.
 */
export const TREND_METRICS: Record<string, string[]> = {
	"cold-start-restore": ["wallMs", "longTaskCount"],
	"activate-background-tab": ["RecalcStyleCount", "longTaskCount"],
	"stream-tokens": ["LayoutCount", "RecalcStyleCount"],
	"scroll-heavy-transcript": ["LayoutCount", "RecalcStyleCount"],
};

/** Median of a numeric array. Empty -> 0. Even length -> mean of the middle two. */
export function median(nums: number[]): number {
	const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
	if (xs.length === 0) return 0;
	const mid = Math.floor(xs.length / 2);
	const m = xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
	return Math.round(m * 1e6) / 1e6;
}

/**
 * Per-scenario, per-metric median across N profile runs. A scenario or
 * metric present in only some runs is medianed over the runs that have it,
 * so one failed pass doesn't drop a scenario or NaN a metric.
 */
export function medianProfile(runs: Profile[]): Profile {
	const scenarioIds = new Set<string>();
	for (const run of runs) {
		for (const id of Object.keys(run)) scenarioIds.add(id);
	}
	const out: Profile = {};
	for (const id of scenarioIds) {
		const metricNames = new Set<string>();
		for (const run of runs) {
			const m = run[id];
			if (m) for (const k of Object.keys(m)) metricNames.add(k);
		}
		const merged: ScenarioMetrics = {};
		for (const metric of metricNames) {
			const values: number[] = [];
			for (const run of runs) {
				const v = run[id]?.[metric];
				if (typeof v === "number" && Number.isFinite(v)) values.push(v);
			}
			merged[metric] = median(values);
		}
		out[id] = merged;
	}
	return out;
}

/** Serialize one entry as a single JSONL line (no trailing newline). */
export function serializeEntry(entry: HistoryEntry): string {
	return JSON.stringify(entry);
}

/** Parse a JSONL history file, skipping blank or unparseable lines. */
export function parseHistory(text: string): HistoryEntry[] {
	const entries: HistoryEntry[] = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		try {
			const parsed = JSON.parse(trimmed) as HistoryEntry;
			if (parsed && typeof parsed === "object" && parsed.scenarios) {
				entries.push(parsed);
			}
		} catch {
			// Skip a corrupt line rather than failing the whole read.
		}
	}
	return entries;
}

/**
 * Format one metric's series across history entries as a compact trend
 * line, e.g. `v1.1.5 231 -> v2.0.0 248 (+7.4% over 2 pts)`. Returns null
 * when the metric never appears (nothing to show).
 */
export function formatTrend(
	entries: HistoryEntry[],
	scenarioId: string,
	metric: string,
): string | null {
	const points: { label: string; value: number }[] = [];
	for (const e of entries) {
		const v = e.scenarios[scenarioId]?.[metric];
		if (typeof v === "number" && Number.isFinite(v)) {
			points.push({ label: e.appVersion || e.date, value: v });
		}
	}
	if (points.length === 0) return null;
	const series = points.map((p) => `${p.label} ${p.value}`).join(" -> ");
	const first = points[0].value;
	const last = points[points.length - 1].value;
	let suffix = " (flat)";
	if (points.length > 1 && first !== 0) {
		const pct = ((last - first) / Math.abs(first)) * 100;
		const sign = pct >= 0 ? "+" : "";
		suffix = ` (${sign}${pct.toFixed(1)}% over ${points.length} pts)`;
	} else if (points.length > 1) {
		suffix = ` (${points.length} pts)`;
	}
	return `${series}${suffix}`;
}
