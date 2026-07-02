/**
 * Pure metric transforms for the Obsidian-in-loop runtime profiler
 * (Gate B-phase2 of the release quality gates).
 *
 * Leaf module: no runtime imports, fully deterministic, unit-tested in
 * `__tests__/metrics.test.ts`. The live CDP plumbing lives in
 * `run-profile.ts`; everything here is pure so it can be tested without a
 * running Obsidian.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2.
 */

/** One entry of a CDP `Performance.getMetrics` response. */
export interface RawMetric {
	name: string;
	value: number;
}

/** A flattened metric map: name -> value. */
export type MetricSnapshot = Record<string, number>;

/**
 * The `Performance`-domain metrics we track. Every one is either a
 * monotonically increasing page-lifetime counter (`*Count`) or a
 * cumulative duration/size, so a before -> after delta is meaningful and
 * HIGHER IS WORSE for all of them. Confirmed present in Obsidian's
 * Chromium via a live `Performance.getMetrics` probe (2026-07-01).
 */
export const TRACKED_METRIC_KEYS = [
	"LayoutCount",
	"RecalcStyleCount",
	"LayoutDuration",
	"RecalcStyleDuration",
	"ScriptDuration",
	"TaskDuration",
	"JSHeapUsedSize",
] as const;
export type TrackedMetricKey = (typeof TRACKED_METRIC_KEYS)[number];

/** Round to 6 significant decimals to keep float noise out of emitted JSON. */
function round6(n: number): number {
	return Math.round(n * 1e6) / 1e6;
}

/** Convert a raw `getMetrics` array into a name -> value map. */
export function toSnapshot(metrics: RawMetric[]): MetricSnapshot {
	const snap: MetricSnapshot = {};
	for (const m of metrics) {
		if (m && typeof m.name === "string" && typeof m.value === "number") {
			snap[m.name] = m.value;
		}
	}
	return snap;
}

/**
 * Per-key delta (`after - before`) over the tracked keys (or a supplied
 * subset). A key missing from either snapshot is treated as 0 on that
 * side, so an absent key yields a clean numeric delta rather than NaN.
 */
export function computeDelta(
	before: MetricSnapshot,
	after: MetricSnapshot,
	keys: readonly string[] = TRACKED_METRIC_KEYS,
): MetricSnapshot {
	const delta: MetricSnapshot = {};
	for (const k of keys) {
		const b = before[k] ?? 0;
		const a = after[k] ?? 0;
		delta[k] = round6(a - b);
	}
	return delta;
}

/**
 * A `long-animation-frame` / `longtask` entry as buffered in-page by the
 * profiler's injected `PerformanceObserver`. Both entry types are
 * supported in Obsidian's renderer (confirmed via a live
 * `PerformanceObserver.supportedEntryTypes` probe, 2026-07-01).
 */
export interface ObserverEntry {
	name: string;
	duration: number;
	blockingDuration?: number;
	styleAndLayoutDuration?: number;
	startTime?: number;
}

export interface LongTaskSummary {
	longTaskCount: number;
	longTaskTotalMs: number;
	maxBlockingMs: number;
	maxStyleLayoutMs: number;
}

/**
 * Aggregate buffered animation-frame entries into gate-friendly scalars.
 * A "long task" is a frame whose duration crosses the 50ms threshold (the
 * Long Tasks API definition). `blockingDuration` and
 * `styleAndLayoutDuration` come from the Long Animation Frames API and are
 * the per-frame paint-cost signals B-v1 cannot see.
 */
export function summarizeLongTasks(
	entries: ObserverEntry[],
	thresholdMs = 50,
): LongTaskSummary {
	let count = 0;
	let total = 0;
	let maxBlocking = 0;
	let maxStyleLayout = 0;
	for (const e of entries) {
		const dur = e.duration ?? 0;
		if (dur >= thresholdMs) {
			count += 1;
			total += dur;
		}
		maxBlocking = Math.max(maxBlocking, e.blockingDuration ?? 0);
		maxStyleLayout = Math.max(maxStyleLayout, e.styleAndLayoutDuration ?? 0);
	}
	return {
		longTaskCount: count,
		longTaskTotalMs: round6(total),
		maxBlockingMs: round6(maxBlocking),
		maxStyleLayoutMs: round6(maxStyleLayout),
	};
}
