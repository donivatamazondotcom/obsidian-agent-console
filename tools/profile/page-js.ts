/**
 * Page JS for the runtime profiler, kept pure so it runs in jsdom tests.
 * Each expression is pure ASCII and self-contained: run-profile.ts
 * base64-wraps it and sends it as one `Runtime.evaluate` over
 * `obsidian dev:cdp` (with `awaitPromise`).
 *
 * A "check" expression returns `""` when its condition doesn't hold yet,
 * else a JSON string `{detail, pageMs}`, where `pageMs` is the page's own
 * `performance.now()` (ms since this document's navigation start).
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2.
 */

/** The vault this page belongs to, as JSON `{name, base}`. */
const VAULT_ID_JS =
	'JSON.stringify({name:app.vault.getName(),base:(app.vault.adapter.getBasePath?app.vault.adapter.getBasePath():"")})';

/**
 * Mark the current document so a later check can tell it from its reload.
 * Returns the vault identity, so the caller can refuse to reload a page
 * that isn't the vault it checked (the CLI's vault routing is per call).
 */
export const MARK_OLD_DOCUMENT_JS =
	`(function(){window.__profOldDocument=true;return ${VAULT_ID_JS};})()`;

/**
 * `""` while the marked document is still current (or the new one isn't
 * ready); else the new page's vault identity, as JSON `{name, base}`.
 */
export const IS_NEW_DOCUMENT_JS =
	`(function(){if(window.__profOldDocument===true)return "";try{return ${VAULT_ID_JS};}catch(e){return "";}})()`;

/** The visible tab panel (inactive panels are `display: none`). */
export const ACTIVE_PANEL_SELECTOR =
	'.agent-client-tab-panel:not([style*="display: none"])';

function hit(detailJs: string): string {
	return `JSON.stringify({detail:${detailJs},pageMs:Math.round(performance.now())})`;
}

/**
 * Check: the first selector matching at least `minCount` elements.
 * `minCount` 1 is "it exists".
 */
export function waitCheckJs(selectors: string[], minCount = 1): string {
	return (
		`(function(){var s=${JSON.stringify(selectors)};` +
		`for(var i=0;i<s.length;i++){if(document.querySelectorAll(s[i]).length>=${minCount})` +
		`return ${hit("s[i]")};}` +
		`return "";})()`
	);
}

/**
 * Find a tab by id (rail keys carry `data-tab-id`), else by index among
 * `tabSelector` matches (the top bar has no id attribute). Expression body
 * that leaves the element in `el` (or null).
 */
function findTabJs(tabSelector: string, tabId: string, index: number): string {
	return (
		`var el=document.querySelector('[role="tab"][data-tab-id=${JSON.stringify(tabId)}]');` +
		// Index fallback only when no tab carries an id (the top bar): on the
		// rail a missing id means a missing tab, never "the nth tab".
		`if(!el&&!document.querySelector('[role="tab"][data-tab-id]')){var all=document.querySelectorAll(${JSON.stringify(tabSelector)});el=all.length>${index}?all[${index}]:null;}`
	);
}

/** Click a tab; returns the page clock at the click, or -1 when absent. */
export function clickTabJs(tabSelector: string, tabId: string, index: number): string {
	return `(function(){${findTabJs(tabSelector, tabId, index)}if(!el)return -1;var at=performance.now();el.click();return at;})()`;
}

/** Check: every check holds (the last one's hit is returned). */
export function allChecksJs(checks: string[]): string {
	const body = checks
		.map((c, i) => `var v${i}=${c};if(!v${i})return "";`)
		.join("");
	return `(function(){${body}return v${checks.length - 1};})()`;
}

/** Check: the tab reports itself selected. */
export function tabSelectedCheckJs(tabSelector: string, tabId: string, index: number): string {
	return (
		`(function(){${findTabJs(tabSelector, tabId, index)}` +
		`if(el&&el.getAttribute("aria-selected")==="true")return ${hit('"selected"')};return "";})()`
	);
}

/**
 * Wrap a check so ONE evaluate resolves the moment it holds: it re-runs on
 * every DOM mutation (MutationObserver fires whether or not the window is
 * visible, unlike rAF or timers), so `pageMs` is the mutation that made it
 * true, not the next poll. Resolves `""` after `timeoutMs`.
 */
export function awaitCheckJs(checkJs: string, timeoutMs: number, failIfHeld = false): string {
	// failIfHeld: a timed wait whose condition already holds when the wait
	// starts can only report when it LOOKED, not when it became true.
	return (
		`(function(){return new Promise(function(res){` +
		`var done=false,mo=null,t=null,n=0,cost=0;` +
		// The observer's own cost lands in the window it measures, so it is
		// counted (checks) and timed (checkMs) and reported with the hit.
		`function fin(v){if(done)return;done=true;if(mo)mo.disconnect();if(t)clearTimeout(t);` +
		`if(v){var o=JSON.parse(v);o.checks=n;o.checkMs=Math.round(cost*10)/10;v=JSON.stringify(o);}res(v);}` +
		`function chk(){if(done)return;var s=performance.now();var v=${checkJs};n++;cost+=performance.now()-s;if(v)fin(v);}` +
		(failIfHeld ? `if(${checkJs}){res(${JSON.stringify(PRE_HELD)});return;}` : "") +
		`mo=new MutationObserver(chk);` +
		`mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:["aria-selected","style","class"]});` +
		`t=setTimeout(function(){fin("");},${timeoutMs});` +
		`chk();});})()`
	);
}

/** Returned by a failIfHeld wait whose condition held before it started. */
export const PRE_HELD = "PRE-HELD";

/**
 * One evaluate that times an interaction in the page: it checks the
 * condition does NOT hold yet, arms a MutationObserver, clicks from a page
 * task (so the click runs as its own task, like a real one), and resolves
 * when the condition holds. Result (JSON): `clickedAt` (page clock at the
 * click), `pageMs` (the mutation that made it hold: the DOM commit), and
 * `frameMs` (the first animation frame after it, ~paint; 0 when no frame
 * came within 1 s, e.g. a hidden page). `""` on timeout, PRE_HELD when the
 * condition already held, `"NO-TARGET"` when the click found nothing.
 */
export function clickAndAwaitJs(clickJs: string, checkJs: string, timeoutMs: number): string {
	return (
		`(function(){return new Promise(function(res){` +
		`if(${checkJs}){res(${JSON.stringify(PRE_HELD)});return;}` +
		`var done=false,mo=null,t=null,clickedAt=-1;` +
		`function fin(v){if(done)return;done=true;if(mo)mo.disconnect();if(t)clearTimeout(t);res(v);}` +
		`function chk(){if(done||clickedAt<0)return;var v=${checkJs};if(!v)return;var pageMs=performance.now();` +
		`if(mo)mo.disconnect();var ft=setTimeout(function(){fin(JSON.stringify({clickedAt:clickedAt,pageMs:pageMs,frameMs:0}));},1000);` +
		`if(typeof requestAnimationFrame==="function")requestAnimationFrame(function(ts){clearTimeout(ft);fin(JSON.stringify({clickedAt:clickedAt,pageMs:pageMs,frameMs:ts}));});}` +
		`mo=new MutationObserver(chk);` +
		`mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:["aria-selected","style","class"]});` +
		`t=setTimeout(function(){fin("");},${timeoutMs});` +
		`setTimeout(function(){var at=${clickJs};if(at<0){fin("NO-TARGET");return;}clickedAt=at;chk();},0);` +
		`});})()`
	);
}

export interface InteractionTiming {
	clickedAt: number;
	pageMs: number;
	frameMs: number;
}

/** Parse a clickAndAwaitJs result; throws with the reason on anything else. */
export function parseInteraction(value: unknown, what: string): InteractionTiming {
	if (value === PRE_HELD) throw new Error(`${what}: already true before the click, so it can't be timed`);
	if (value === "NO-TARGET") throw new Error(`${what}: the click target is missing`);
	if (value === "" || value === undefined || value === null) throw new Error(`${what}: timed out`);
	if (typeof value !== "string") throw new Error(`${what}: malformed timing ${JSON.stringify(value)}`);
	const o = JSON.parse(value) as Partial<InteractionTiming>;
	if (typeof o.clickedAt !== "number" || typeof o.pageMs !== "number" || typeof o.frameMs !== "number") {
		throw new Error(`${what}: malformed timing ${value}`);
	}
	return { clickedAt: o.clickedAt, pageMs: o.pageMs, frameMs: o.frameMs };
}

export interface WaitHit {
	detail: string;
	pageMs: number;
	/** How many times the in-page observer ran the check, and how long that took. */
	checks?: number;
	checkMs?: number;
}

/** Parse a check result; null for no hit or a malformed value. */
export function parseWaitHit(value: unknown): WaitHit | null {
	if (typeof value !== "string" || value === "") return null;
	try {
		const o = JSON.parse(value) as { detail?: unknown; pageMs?: unknown; checks?: unknown; checkMs?: unknown };
		if (typeof o.detail === "string" && typeof o.pageMs === "number") {
			const hit: WaitHit = { detail: o.detail, pageMs: o.pageMs };
			if (typeof o.checks === "number") hit.checks = o.checks;
			if (typeof o.checkMs === "number") hit.checkMs = o.checkMs;
			return hit;
		}
	} catch {
		/* malformed — treat as no hit */
	}
	return null;
}

/**
 * Install the long-frame observer once per document, and clear the buffer
 * on EVERY call, so a scenario reads only frames from its own window.
 * Observes `long-animation-frame` only (falling back to `longtask` where
 * LoAF is unsupported), so one stall is never counted twice. Each entry
 * keeps its `entryType`, and `styleAndLayoutMs` is computed from the LoAF
 * `styleAndLayoutStart` attribute (the end of the frame minus the start of
 * its rendering style/layout); a longtask entry has no such attribute.
 * `buffered: true` backfills frames from earlier in the document, which is
 * how cold start sees the restore's frames when it installs after reload.
 */
export const OBSERVER_INSTALL_JS =
	"(function(){window.__profBuf=[];if(window.__profObs)return window.__profObsType;" +
	"var types=(window.PerformanceObserver&&PerformanceObserver.supportedEntryTypes)||[];" +
	'var type=types.indexOf("long-animation-frame")>=0?"long-animation-frame":(types.indexOf("longtask")>=0?"longtask":"");' +
	'if(!type)return "OBS-ERR:no long-frame entry type";' +
	"try{var po=new PerformanceObserver(function(l){var es=l.getEntries();for(var i=0;i<es.length;i++){var e=es[i];" +
	"var sl=e.styleAndLayoutStart?Math.max(0,e.startTime+e.duration-e.styleAndLayoutStart):0;" +
	"window.__profBuf.push({entryType:e.entryType,duration:e.duration,blockingDuration:e.blockingDuration||0,styleAndLayoutMs:sl,startTime:e.startTime});}});" +
	"po.observe({type:type,buffered:true});window.__profObs=po;window.__profObsType=type;return type;}" +
	'catch(err){return "OBS-ERR:"+err.message;}})()';

/** Read and clear the buffered entries. */
export const OBSERVER_READ_JS =
	"(function(){var b=window.__profBuf||[];window.__profBuf=[];return b;})()";
