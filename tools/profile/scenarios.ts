/**
 * Runtime-profiler scenarios (Gate B-phase2). Each scenario maps to a real
 * prior incident and owns its full measurement, because the cold-start
 * scenario measures ACROSS a `Page.reload` while the others measure a
 * before -> after delta within one page. Obsidian's `Page.reload` does NOT
 * reset the Performance counters (GB-T05), so cold start uses
 * reset-independent signals only: its own page clock and long frames.
 *
 * The live-Obsidian plumbing is injected via {@link ProfileContext} so this
 * module stays free of the `Cdp` transport; the page JS lives in
 * `page-js.ts`, and both are unit-tested against jsdom.
 *
 * DOM targets (re-checked against `main` on 2026-11-15): each tab's
 * transcript lives in a `.agent-client-tab-panel`, and only the active one
 * is displayed. Messages are `.agent-client-message-row`; an assistant row
 * holds `.agent-client-message-assistant`. Tabs are `.agent-client-tab` in
 * the top bar or `.agent-client-tab-rail-key` on the vertical rail (the
 * new-install default since v2.5.0, and the studio seed's layout); rail
 * keys carry `data-tab-id`, so the profiler clicks seeded tabs by id there.
 *
 * A scenario whose target is missing, or whose wait times out, THROWS. The
 * orchestrator then reports the run as incomplete and refuses to record or
 * ratchet it, so a stale selector can't pass as a measurement.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2 (scenario table).
 */
import {
	computeDelta,
	summarizeLongTasks,
	type MetricSnapshot,
	type ObserverEntry,
} from "./metrics";
import type { ScenarioMetrics } from "./baseline";
import {
	ACTIVE_PANEL_SELECTOR,
	allChecksJs,
	clickAndAwaitJs,
	clickTabJs,
	parseInteraction,
	tabSelectedCheckJs,
	waitCheckJs,
	type WaitHit,
} from "./page-js";
import { HEAVY_MESSAGE_COUNT, HEAVY_TAB_ID, LIGHT_TAB_ID } from "./seed";

/** Live-Obsidian capabilities a scenario needs, injected by run-profile.ts. */
export interface ProfileContext {
	/** Run pure-ASCII JS in the renderer (base64-wrapped by the impl) and return the value. */
	evalInPage<T = unknown>(js: string): Promise<T>;
	/**
	 * Like evalInPage, for JS that ACTS (clicks, scrolls, mutates) or times
	 * something: sent once, never retried, so a dropped reply can't repeat
	 * the action or report a late time. A dropped reply rejects.
	 */
	act<T = unknown>(js: string): Promise<T>;
	/** `Performance.getMetrics` -> flattened snapshot. */
	snapshot(): Promise<MetricSnapshot>;
	/** Install the long-frame observer (once per document) and clear its buffer. */
	installObserver(): Promise<void>;
	/** Read and clear the buffered long-frame entries. */
	readObserver(): Promise<ObserverEntry[]>;
	/**
	 * Hard `Page.reload` (destroys the JS context; the on-disk seed wins).
	 * Resolves once the new document answers.
	 */
	reload(): Promise<void>;
	/**
	 * Resolve when a `page-js` check expression holds, with the page clock
	 * at the DOM mutation that made it hold. Rejects on timeout. With
	 * `failIfHeld`, also rejects when the check already held as the wait
	 * started (the time would be when it looked, not when it became true).
	 */
	waitFor(
		checkJs: string,
		timeoutMs: number,
		what: string,
		opts?: { failIfHeld?: boolean },
	): Promise<WaitHit>;
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

const ROW = ".agent-client-message-row";
const ACTIVE_ROWS = `${ACTIVE_PANEL_SELECTOR} ${ROW}`;
const SCROLL_SELECTOR = `${ACTIVE_PANEL_SELECTOR} .agent-client-chat-view-messages`;
/** Both tab layouts; only one renders at a time, in tab order. */
const TAB_SELECTOR = ".agent-client-tab, .agent-client-tab-rail-key";
const HEAVY_INDEX = 0;
const LIGHT_INDEX = 1;
const STREAM_TOKENS = 50;
const SCROLL_STEPS = 40;

/** The active panel shows the whole heavy transcript. */
const HEAVY_RENDERED_JS = waitCheckJs([ACTIVE_ROWS], HEAVY_MESSAGE_COUNT);

/** Merge a metric delta with the long-frame summary into one flat record. */
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

/** Click a seeded tab; returns the page clock at the click. Throws if absent. */
async function clickTab(
	ctx: ProfileContext,
	tabId: string,
	index: number,
	role: string,
): Promise<number> {
	const at = await ctx.act<number>(clickTabJs(TAB_SELECTOR, tabId, index));
	if (typeof at !== "number" || at < 0) {
		throw new Error(
			`activate: no ${role} tab matches "${TAB_SELECTOR}" — the scenario needs the heavy tab plus a light tab`,
		);
	}
	return at;
}

/**
 * Scenario 1 — cold-start restore of the heavy session (active tab).
 * Regression class: the ~5,750 ms restore. Signal: ms from navigation
 * start to the whole 201-row heavy transcript in the active panel (which
 * also proves the heavy tab, not the light one, restored), plus long frames.
 */
const coldStartRestore: Scenario = {
	id: "cold-start-restore",
	title: "Cold-start restore of the heavy session",
	primarySignal: "wallMs (navigation start to full heavy transcript) + long frames",
	async measure(ctx) {
		await ctx.reload();
		// New document: install as early as possible; `buffered: true`
		// backfills the restore's frames from before observe().
		await ctx.installObserver();
		const hit = await ctx.waitFor(
			HEAVY_RENDERED_JS,
			30_000,
			`${HEAVY_MESSAGE_COUNT} restored rows`,
			{ failIfHeld: true },
		);
		ctx.log(`restore: ${HEAVY_MESSAGE_COUNT} rows at ${hit.pageMs}ms after navigation start`);
		await ctx.sleep(500);
		const obs = await ctx.readObserver();
		// wallMs = navigation start -> full heavy transcript, from the page's
		// own clock (since 2026-11-15; earlier points measured ms after a
		// fixed 1.5 s post-reload sleep and are not comparable).
		return mergeMetrics({}, obs, {
			wallMs: hit.pageMs,
			// The wait's own observer cost inside the measured window.
			waitCheckMs: hit.checkMs ?? 0,
		});
	},
};

/**
 * Scenario 2 — activate the heavy tab from the background.
 * Regression class: tab-activation long-task / flicker. Inactive panels
 * render a placeholder, so activating the heavy tab re-renders all 201
 * rows. One evaluate clicks from a page task and times, in the page, the
 * click to the DOM commit that shows the heavy tab selected with every row
 * (`activateMs`) and to the next animation frame (`activateFrameMs`, 0 when
 * the page rendered no frame). No CLI round trip is inside either number.
 */
const activateBackgroundTab: Scenario = {
	id: "activate-background-tab",
	title: "Activate the heavy background tab",
	primarySignal: "activateMs, longTaskCount, RecalcStyleCount delta",
	async measure(ctx) {
		// Park on the light tab so the heavy one is genuinely backgrounded.
		await clickTab(ctx, LIGHT_TAB_ID, LIGHT_INDEX, "light");
		await ctx.waitFor(
			tabSelectedCheckJs(TAB_SELECTOR, LIGHT_TAB_ID, LIGHT_INDEX),
			5_000,
			"light tab selected",
		);
		await ctx.sleep(600);
		await ctx.installObserver();
		const before = await ctx.snapshot();
		const what = `heavy tab selected with ${HEAVY_MESSAGE_COUNT} rows`;
		const timing = parseInteraction(
			await ctx.act<string>(
				clickAndAwaitJs(
					clickTabJs(TAB_SELECTOR, HEAVY_TAB_ID, HEAVY_INDEX),
					allChecksJs([
						tabSelectedCheckJs(TAB_SELECTOR, HEAVY_TAB_ID, HEAVY_INDEX),
						HEAVY_RENDERED_JS,
					]),
					15_000,
				),
			),
			`activate: ${what}`,
		);
		await ctx.sleep(300);
		const after = await ctx.snapshot();
		const obs = await ctx.readObserver();
		const r1 = (n: number) => Math.round(Math.max(0, n) * 10) / 10;
		return mergeMetrics(computeDelta(before, after), obs, {
			activateMs: r1(timing.pageMs - timing.clickedAt),
			activateFrameMs: timing.frameMs > 0 ? r1(timing.frameMs - timing.clickedAt) : 0,
		});
	},
};

/**
 * Scenario 3 — grow the last assistant row (streaming proxy).
 * Appends ~50 tokens to a temporary span in the active panel's last
 * assistant row, forcing a layout after each, then removes the span.
 *
 * NOTE (honesty): this is NOT a re-render storm test. It never goes through
 * React or the markdown renderer, and its LayoutCount (50 forced + 1) is
 * set by the proxy itself. What it measures is the style/layout cost of a
 * growing reply in the heavy transcript, plus anything the plugin's
 * observers do in response. A real-stream scenario needs a fake streaming
 * agent (follow-up).
 */
const streamTokens: Scenario = {
	id: "stream-tokens",
	title: "Grow the last assistant row ~50 tokens (layout proxy)",
	primarySignal: "maxStyleLayoutMs, long frames",
	async measure(ctx) {
		await ctx.installObserver();
		const before = await ctx.snapshot();
		const streamed = await ctx.act<boolean>(
			`(function(){var rows=document.querySelectorAll(${JSON.stringify(ACTIVE_ROWS)});var last=null;` +
				`for(var i=rows.length-1;i>=0;i--){if(rows[i].querySelector(".agent-client-message-assistant")){last=rows[i];break;}}` +
				`if(!last)return false;var host=last.querySelector(".agent-client-message-assistant");` +
				`var span=document.createElement("span");host.appendChild(span);var acc="";` +
				`for(var t=0;t<${STREAM_TOKENS};t++){acc+=" tok"+t;span.textContent=acc;void host.offsetHeight;}` +
				`span.remove();return true;})()`,
		);
		if (!streamed) {
			throw new Error(`stream: no assistant row in the active panel ("${ACTIVE_ROWS}")`);
		}
		await ctx.sleep(400);
		const after = await ctx.snapshot();
		const obs = await ctx.readObserver();
		return mergeMetrics(computeDelta(before, after), obs);
	},
};

/**
 * Scenario 4 — scroll the heavy transcript top to bottom.
 * Regression class: auto-scroll-pin jitter / forced reflow (I36–I39).
 * Steps once per animation frame (raced against a 100 ms timeout, so a
 * throttled window can't hang it), so the plugin's scroll handlers and
 * observers run at every position. Throws unless a scroll event fired for
 * (nearly) every step. Restores the starting position.
 */
const scrollHeavyTranscript: Scenario = {
	id: "scroll-heavy-transcript",
	title: "Scroll the heavy transcript top-to-bottom",
	primarySignal: "LayoutCount delta (forced reflows), maxStyleLayoutMs",
	async measure(ctx) {
		await ctx.installObserver();
		const before = await ctx.snapshot();
		const events = await ctx.act<number>(
			`(async function(){var sc=document.querySelector(${JSON.stringify(SCROLL_SELECTOR)});` +
				`if(!sc||sc.scrollHeight<=sc.clientHeight)return -1;` +
				`var start=sc.scrollTop;var max=sc.scrollHeight-sc.clientHeight;var n=0;var on=function(){n++;};` +
				`sc.addEventListener("scroll",on);` +
				`var frame=function(){return new Promise(function(r){var t=setTimeout(r,100);` +
				`if(typeof requestAnimationFrame==="function")requestAnimationFrame(function(){clearTimeout(t);r();});});};` +
				`for(var s=0;s<=${SCROLL_STEPS};s++){sc.scrollTop=Math.round(max*s/${SCROLL_STEPS});await frame();}` +
				`sc.removeEventListener("scroll",on);sc.scrollTop=start;return n;})()`,
		);
		if (typeof events !== "number" || events < 0) {
			throw new Error(`scroll: no overflowing scroll container matches "${SCROLL_SELECTOR}"`);
		}
		// One step can be a no-op (already at that position).
		if (events < SCROLL_STEPS) {
			throw new Error(
				`scroll: only ${events} scroll events for ${SCROLL_STEPS + 1} steps — the transcript didn't scroll`,
			);
		}
		await ctx.sleep(400);
		const after = await ctx.snapshot();
		const obs = await ctx.readObserver();
		return mergeMetrics(computeDelta(before, after), obs, { scrollEvents: events });
	},
};

export const SCENARIOS: Scenario[] = [
	coldStartRestore,
	activateBackgroundTab,
	streamTokens,
	scrollHeavyTranscript,
];
