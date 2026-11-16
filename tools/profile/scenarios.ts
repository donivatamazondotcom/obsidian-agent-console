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
 * `.agent-client-message-row`, and tabs are `.agent-client-tab` (top tab
 * bar) or `.agent-client-tab-rail-key` (vertical rail — the new-install
 * default since v2.5.0, and the studio seed's `tabDisplay`).
 *
 * A scenario whose target is missing THROWS rather than measuring nothing:
 * the orchestrator then drops it from the profile, so a stale selector shows
 * up as a missing scenario instead of a plausible-looking bogus delta.
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
	/**
	 * Hard `Page.reload` (destroys the JS context; on-disk seed wins on
	 * reload). Resolves once the new document answers.
	 */
	reload(): Promise<void>;
	/**
	 * Poll for the first matching selector; resolve with the wall-ms the
	 * wait took, which selector matched, and the page's `performance.now()`
	 * at the hit (ms since its navigation start). Rejects on timeout.
	 */
	waitForSelector(
		selectors: string[],
		timeoutMs?: number,
	): Promise<{ ms: number; selector: string; pageMs: number }>;
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
const MESSAGE_ROW_SELECTOR = MESSAGE_SELECTORS[0];
const SCROLL_SELECTOR = ".agent-client-chat-view-messages";
/** Both tab layouts; only one renders at a time, in tab order. */
const TAB_SELECTOR = ".agent-client-tab, .agent-client-tab-rail-key";

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

/** Click the nth tab in either layout (0-based). Returns whether it existed. */
function clickTabJs(index: number): string {
	return (
		`(function(){var t=document.querySelectorAll(${JSON.stringify(TAB_SELECTOR)});` +
		`if(t.length>${index}){t[${index}].click();return true;}return false;})()`
	);
}

/**
 * Scenario 1 — cold-start restore of the heavy session (active tab).
 * Regression class: the ~5,750 ms restore. Signal: ms from navigation
 * start to the first restored message row, plus long frames.
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
		// A restored ROW, never the container: the empty message list renders
		// before any restore, so matching it timed nothing (15ms, 2026-11-15).
		const { selector, pageMs } = await ctx.waitForSelector(
			[MESSAGE_ROW_SELECTOR],
			30_000,
		);
		ctx.log(`restore: first message via ${selector} at ${pageMs}ms after navigation start`);
		await ctx.sleep(500);
		const obs = await ctx.readObserver();
		// Obsidian's Page.reload does NOT reset the Performance counters, so
		// absolute post-reload LayoutCount/RecalcStyleCount/ScriptDuration
		// accumulate across runs and are useless for gating (GB-T05). The
		// reset-independent signals are wall-ms to the first restored message
		// plus the long-frame count observed during restore.
		// wallMs = navigation start -> first restored row, from the page's
		// own clock (since 2026-11-15; earlier points measured ms after a
		// fixed 1.5 s post-reload sleep and are not comparable).
		return mergeMetrics({}, obs, { wallMs: pageMs });
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
		const parked = await ctx.evalInPage<boolean>(clickTabJs(1));
		if (!parked) {
			throw new Error(
				`activate: no second tab matches "${TAB_SELECTOR}" — the scenario needs the heavy tab plus a light tab`,
			);
		}
		await ctx.sleep(600);
		await ctx.installObserver();
		const before = await ctx.snapshot();
		const clicked = await ctx.evalInPage<boolean>(clickTabJs(0));
		if (!clicked) {
			throw new Error(`activate: no heavy tab matches "${TAB_SELECTOR}"`);
		}
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
		const streamed = await ctx.evalInPage<boolean>(
			`(function(){var rows=document.querySelectorAll(${JSON.stringify(MESSAGE_SELECTORS[0])});` +
				`if(!rows.length)return false;var last=rows[rows.length-1];var base=last.textContent;var acc="";` +
				`for(var t=0;t<50;t++){acc+=" tok"+t;last.textContent=base+acc;void last.offsetHeight;}` +
				`last.textContent=base;return true;})()`,
		);
		if (!streamed) {
			throw new Error(
				`stream: no message row matches "${MESSAGE_SELECTORS[0]}"`,
			);
		}
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
		if (!scrolled) {
			throw new Error(
				`scroll: no overflowing scroll container matches "${SCROLL_SELECTOR}"`,
			);
		}
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
