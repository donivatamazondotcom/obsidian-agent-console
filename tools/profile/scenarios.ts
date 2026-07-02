/**
 * Runtime-profiler scenarios (Gate B-phase2). Each scenario maps to a real
 * prior incident and owns its full measurement, because the cold-start
 * scenario measures ACROSS a `Page.reload` (which resets the page-lifetime
 * counters) while the others measure a before -> after delta within one
 * page.
 *
 * The live-Obsidian plumbing is injected via {@link ProfileContext} so this
 * module stays free of the `Cdp` transport and is easy to reason about.
 *
 * DOM selectors are the real agent-console classes, confirmed live against
 * the studio fixtures vault (2026-07-01): the message list/scroll container
 * is `.agent-client-chat-view-messages`, each message is
 * `.agent-client-message-row`, and tabs are `.agent-client-tab`.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2 (scenario table).
 */
import {
	computeDelta,
	summarizeLongTasks,
	toSnapshot,
	type MetricSnapshot,
	type ObserverEntry,
	type RawMetric,
} from "./metrics";
import type { ScenarioMetrics } from "./baseline";

/** Live-Obsidian capabilities a scenario needs, injected by run-profile.ts. */
export interface ProfileContext {
	/** Run pure-ASCII JS in the renderer (base64-wrapped by the impl) and return the value. */
	evalInPage<T = unknown>(js: string): Promise<T>;
	/** `Performance.getMetrics` -> flattened snapshot. */
	snapshot(): Promise<MetricSnapshot>;
	/** Install the in-page longtask + long-animation-frame buffer (idempotent). */
	installObserver(): Promise<void>;
	/** Read and clear the buffered animation-frame entries. */
	readObserver(): Promise<ObserverEntry[]>;
	/** Hard `Page.reload` (destroys the JS context; on-disk seed wins on reload). */
	reload(): Promise<void>;
	/**
	 * Poll for the first matching selector; resolve with the wall-ms it took
	 * to appear and which selector matched. Rejects on timeout.
	 */
	waitForSelector(
		selectors: string[],
		timeoutMs?: number,
	): Promise<{ ms: number; selector: string }>;
	sleep(ms: number): Promise<void>;
	log(msg: string): void;
}

export interface Scenario {
	id: string;
	title: string;
	/** Which signal this scenario primarily guards (for the report + docs). */
	primarySignal: string;
	measure(ctx: ProfileContext): Promise<ScenarioMetrics>;
}

/** Real agent-console selectors (confirmed live 2026-07-01). */
const MESSAGE_SELECTORS = [
	".agent-client-message-row",
	".agent-client-chat-view-messages",
];
const SCROLL_SELECTOR = ".agent-client-chat-view-messages";
const TAB_SELECTOR = ".agent-client-tab";

/** Merge a metric delta with the long-task summary into one flat record. */
function mergeMetrics(
	delta: MetricSnapshot,
	obs: ObserverEntry[],
	extra: Record<string, number> = {},
): ScenarioMetrics {
	const lt = summarizeLongTasks(obs);
	return {
		...delta,
		longTaskCount: lt.longTaskCount,
		longTaskTotalMs: lt.longTaskTotalMs,
		maxBlockingMs: lt.maxBlockingMs,
		maxStyleLayoutMs: lt.maxStyleLayoutMs,
		...extra,
	};
}

/** Click the nth `.agent-client-tab` (0-based). Returns whether it existed. */
function clickTabJs(index: number): string {
	return (
		`(function(){var t=document.querySelectorAll(${JSON.stringify(TAB_SELECTOR)});` +
		`if(t.length>${index}){t[${index}].click();return true;}return false;})()`
	);
}

/**
 * Scenario 1 — cold-start restore of the heavy session (active tab).
 * Regression class: the ~5,750 ms restore. Signal: wall-ms to the first
 * restored message row + post-reload absolute layout/script counters.
 * Measured across a reload, so NOT a delta (counters reset on reload).
 */
const coldStartRestore: Scenario = {
	id: "cold-start-restore",
	title: "Cold-start restore of the heavy session",
	primarySignal: "wallMs (first restored message) + long-frame count",
	async measure(ctx) {
		await ctx.reload();
		// New JS context: install the buffered observer as early as possible;
		// buffered:true backfills frames from before observe() within this doc.
		await ctx.installObserver();
		const { ms, selector } = await ctx.waitForSelector(
			MESSAGE_SELECTORS,
			30_000,
		);
		ctx.log(`restore: first message via ${selector} in ${ms}ms`);
		await ctx.sleep(500);
		const obs = await ctx.readObserver();
		// Obsidian's Page.reload does NOT reset the Performance counters, so
		// absolute post-reload LayoutCount/RecalcStyleCount/ScriptDuration
		// accumulate across runs and are useless for gating (GB-T05). The
		// reset-independent signals are wall-ms to the first restored message
		// plus the long-frame count observed during restore.
		return mergeMetrics({}, obs, { wallMs: ms });
	},
};

/**
 * Scenario 2 — activate the heavy tab from the background.
 * Regression class: tab-activation long-task / flicker. Requires two
 * seeded tabs (heavy tab0 + light tab1). We switch AWAY to the light tab,
 * settle, then measure switching BACK to the heavy tab — the real
 * background-heavy-tab activation cost.
 */
const activateBackgroundTab: Scenario = {
	id: "activate-background-tab",
	title: "Activate the heavy background tab",
	primarySignal: "longTaskCount, ScriptDuration delta",
	async measure(ctx) {
		// Park on the light tab so the heavy one is genuinely backgrounded.
		await ctx.evalInPage<boolean>(clickTabJs(1));
		await ctx.sleep(600);
		await ctx.installObserver();
		const before = await ctx.snapshot();
		const clicked = await ctx.evalInPage<boolean>(clickTabJs(0));
		ctx.log(`activate: heavy-tab click dispatched=${clicked}`);
		try {
			await ctx.waitForSelector(MESSAGE_SELECTORS, 10_000);
		} catch {
			/* fall through — still record whatever the switch cost */
		}
		await ctx.sleep(600);
		const after = await ctx.snapshot();
		const obs = await ctx.readObserver();
		return mergeMetrics(computeDelta(before, after), obs);
	},
};

/**
 * Scenario 3 — stream tokens into the active tab.
 * Regression class: per-token re-render storm. Signal: RecalcStyleCount +
 * long frames while ~50 incremental text updates hit the last message row.
 *
 * NOTE (honesty): a live agent stream is neither hermetic nor
 * deterministic, so this drives a PROXY — 50 incremental text appends to
 * the last message row with a forced layout each — exercising the same
 * style/layout/paint path a real token stream would. Documented as a proxy
 * in the spec; it still guards the render-storm regression class.
 */
const streamTokens: Scenario = {
	id: "stream-tokens",
	title: "Stream ~50 tokens into the active tab (proxy)",
	primarySignal: "RecalcStyleCount delta, long frames",
	async measure(ctx) {
		await ctx.installObserver();
		const before = await ctx.snapshot();
		await ctx.evalInPage<boolean>(
			`(function(){var rows=document.querySelectorAll(${JSON.stringify(MESSAGE_SELECTORS[0])});` +
				`if(!rows.length)return false;var last=rows[rows.length-1];var base=last.textContent;var acc="";` +
				`for(var t=0;t<50;t++){acc+=" tok"+t;last.textContent=base+acc;void last.offsetHeight;}` +
				`last.textContent=base;return true;})()`,
		);
		await ctx.sleep(400);
		const after = await ctx.snapshot();
		const obs = await ctx.readObserver();
		return mergeMetrics(computeDelta(before, after), obs);
	},
};

/**
 * Scenario 4 — scroll the heavy transcript.
 * Regression class: auto-scroll-pin jitter / forced reflow (I36–I39).
 * Signal: forced-reflow count (LayoutCount delta) + maxStyleLayoutMs.
 */
const scrollHeavyTranscript: Scenario = {
	id: "scroll-heavy-transcript",
	title: "Scroll the heavy transcript top-to-bottom",
	primarySignal: "LayoutCount delta (forced reflows), maxStyleLayoutMs",
	async measure(ctx) {
		await ctx.installObserver();
		const before = await ctx.snapshot();
		const scrolled = await ctx.evalInPage<boolean>(
			`(function(){var sc=document.querySelector(${JSON.stringify(SCROLL_SELECTOR)});` +
				`if(!sc||sc.scrollHeight<=sc.clientHeight)return false;var steps=40;var max=sc.scrollHeight-sc.clientHeight;` +
				`for(var s=0;s<=steps;s++){sc.scrollTop=Math.round(max*s/steps);void sc.scrollTop;}` +
				`sc.scrollTop=0;return true;})()`,
		);
		ctx.log(`scroll: dispatched=${scrolled}`);
		await ctx.sleep(400);
		const after = await ctx.snapshot();
		const obs = await ctx.readObserver();
		return mergeMetrics(computeDelta(before, after), obs);
	},
};

export const SCENARIOS: Scenario[] = [
	coldStartRestore,
	activateBackgroundTab,
	streamTokens,
	scrollHeavyTranscript,
];

/** The raw-metrics helper re-exported for the orchestrator's snapshot(). */
export function snapshotFromRaw(metrics: RawMetric[]): MetricSnapshot {
	return toSnapshot(metrics);
}
