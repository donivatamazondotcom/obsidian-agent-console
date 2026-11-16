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

/** Mark the current document so a later check can tell it from its reload. */
export const MARK_OLD_DOCUMENT_JS =
	"(function(){window.__profOldDocument=true;return true;})()";

/** True once the marked document has been replaced by a fresh one. */
export const IS_NEW_DOCUMENT_JS =
	"(function(){return window.__profOldDocument!==true;})()";

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
		`if(!el){var all=document.querySelectorAll(${JSON.stringify(tabSelector)});el=all.length>${index}?all[${index}]:null;}`
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
export function awaitCheckJs(checkJs: string, timeoutMs: number): string {
	return (
		`(function(){return new Promise(function(res){` +
		`var done=false,mo=null,t=null;` +
		`function fin(v){if(done)return;done=true;if(mo)mo.disconnect();if(t)clearTimeout(t);res(v);}` +
		`function chk(){if(done)return;var v=${checkJs};if(v)fin(v);}` +
		`mo=new MutationObserver(chk);` +
		`mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true});` +
		`t=setTimeout(function(){fin("");},${timeoutMs});` +
		`chk();});})()`
	);
}

export interface WaitHit {
	detail: string;
	pageMs: number;
}

/** Parse a check result; null for no hit or a malformed value. */
export function parseWaitHit(value: unknown): WaitHit | null {
	if (typeof value !== "string" || value === "") return null;
	try {
		const o = JSON.parse(value) as { detail?: unknown; pageMs?: unknown };
		if (typeof o.detail === "string" && typeof o.pageMs === "number") {
			return { detail: o.detail, pageMs: o.pageMs };
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
