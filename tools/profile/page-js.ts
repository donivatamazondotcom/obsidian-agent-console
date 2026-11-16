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

const PRE_HELD_TOKEN = "PRE-HELD";

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
 * `armJs` runs once, in the first evaluate that sees the new document (even
 * before `app` exists), so a timed wait is armed as early as possible.
 */
export function newDocumentJs(armJs = ""): string {
	return (
		`(function(){if(window.__profOldDocument===true)return "";` +
		(armJs ? `if(!window.__profArmed){window.__profArmed=true;${armJs};}` : "") +
		`try{return ${VAULT_ID_JS};}catch(e){return "";}})()`
	);
}

export const IS_NEW_DOCUMENT_JS = newDocumentJs();

const MO_OPTIONS =
	'{childList:true,subtree:true,attributes:true,attributeFilter:["aria-selected","style","class"]}';

/**
 * Statement: arm a wait for `checkJs` that stores its hit in the page
 * (`window.__profArm`), so it can be collected later by any number of
 * calls without losing the time. Records `held` when the check is already
 * true at arming, and a thrown check as an error.
 */
export function armWaitJs(checkJs: string): string {
	return (
		`var a=window.__profArm={hit:"",held:false,err:"",n:0,cost:0,cb:null,armedAt:performance.now()};` +
		`var chk=function(){try{var s=performance.now();var v=${checkJs};a.n++;a.cost+=performance.now()-s;return v;}catch(e){a.err=String(e&&e.message||e);return "";}};` +
		`if(chk()){a.held=true;}else if(!a.err){var mo=new MutationObserver(function(){if(a.hit||a.err)return;var v=chk();` +
		// Observe `document`, not documentElement: the first evaluate on a
		// new document can run before documentElement exists. The observer
		// disconnects itself after 60 s whatever happens to the run.
		`if(v||a.err){a.hit=v;mo.disconnect();if(a.cb)a.cb();}});mo.observe(document,${MO_OPTIONS});` +
		`setTimeout(function(){mo.disconnect();},60000);}`
	);
}

/**
 * Collect the armed wait: the stored hit (with its check count and cost),
 * PRE_HELD, `"CHECK-ERR:<msg>"`, `"NO-ARM"`, or `""` when `timeoutMs`
 * passes first. Reading only: safe to retry.
 */
export function collectArmedJs(timeoutMs: number): string {
	return (
		`(function(){return new Promise(function(res){var a=window.__profArm;` +
		`if(!a){res("NO-ARM");return;}if(a.held){res(${JSON.stringify(PRE_HELD_TOKEN)});return;}` +
		`var done=function(){if(a.err){res("CHECK-ERR:"+a.err);return;}var o=JSON.parse(a.hit);o.checks=a.n;o.checkMs=Math.round(a.cost*10)/10;o.armedAt=Math.round(a.armedAt);res(JSON.stringify(o));};` +
		`if(a.hit||a.err){done();return;}var t=setTimeout(function(){a.cb=null;res("");},${timeoutMs});` +
		`a.cb=function(){clearTimeout(t);done();};});})()`
	);
}

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
		`function chk(){if(done)return;var v;try{var s=performance.now();v=${checkJs};n++;cost+=performance.now()-s;}catch(e){done=true;if(mo)mo.disconnect();if(t)clearTimeout(t);res("CHECK-ERR:"+String(e&&e.message||e));return;}if(v)fin(v);}` +
		(failIfHeld ? `if(${checkJs}){res(${JSON.stringify(PRE_HELD)});return;}` : "") +
		`mo=new MutationObserver(chk);` +
		`mo.observe(document.documentElement,${MO_OPTIONS});` +
		`t=setTimeout(function(){fin("");},${timeoutMs});` +
		`chk();});})()`
	);
}

/** Returned by a wait whose condition held before it started. */
export const PRE_HELD = PRE_HELD_TOKEN;

/**
 * One evaluate that times an interaction in the page: it checks the
 * condition does NOT hold yet, arms a MutationObserver, clicks from a page
 * task (so the click runs as its own task, like a real one), and resolves
 * when the condition holds. Result (JSON): `clickedAt` (page clock at the
 * click), `pageMs` (the mutation that made it hold: the DOM commit), and
 * `frameMs` (when the next frame's style, layout and paint are done).
 * Otherwise: `""` on timeout, PRE_HELD when the condition already held,
 * `"NO-TARGET"` when the click found nothing, `"NO-FRAME"` when no frame
 * came within 1 s (a hidden page), `"CHECK-ERR:<msg>"` when the check threw.
 */
export function clickAndAwaitJs(clickJs: string, checkJs: string, timeoutMs: number): string {
	return (
		`(function(){return new Promise(function(res){` +
		`var done=false,mo=null,t=null,clickedAt=-1;` +
		`function fin(v){if(done)return;done=true;if(mo)mo.disconnect();if(t)clearTimeout(t);res(v);}` +
		`function check(){try{return ${checkJs};}catch(e){fin("CHECK-ERR:"+String(e&&e.message||e));return "";}}` +
		`if(check()){fin(${JSON.stringify(PRE_HELD_TOKEN)});return;}` +
		// On the hit: stop the main timeout, then time the frame AFTER its
		// style, layout and paint: a task posted from the rAF callback runs
		// once that frame's rendering is done.
		`function chk(){if(done||clickedAt<0)return;var v=check();if(!v||done)return;var pageMs=performance.now();` +
		`if(mo)mo.disconnect();mo=null;if(t)clearTimeout(t);t=null;` +
		`var ft=setTimeout(function(){fin("NO-FRAME:"+document.visibilityState);},1000);` +
		`if(typeof requestAnimationFrame!=="function"){clearTimeout(ft);fin("NO-FRAME:"+document.visibilityState);return;}` +
		`requestAnimationFrame(function(){setTimeout(function(){clearTimeout(ft);` +
		`fin(JSON.stringify({clickedAt:clickedAt,pageMs:pageMs,frameMs:performance.now()}));},0);});}` +
		`mo=new MutationObserver(chk);` +
		`mo.observe(document.documentElement,${MO_OPTIONS});` +
		`t=setTimeout(function(){fin("");},${timeoutMs});` +
		// Re-check right before the click: the page may have changed since.
		`setTimeout(function(){if(done)return;var pre=check();if(done)return;if(pre){fin(${JSON.stringify(PRE_HELD_TOKEN)});return;}` +
		`var at=${clickJs};if(at<0){fin("NO-TARGET");return;}clickedAt=at;chk();},0);` +
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
	if (typeof value === "string" && value.startsWith("NO-FRAME")) {
		throw new Error(`${what}: no frame rendered within 1 s (page ${value.slice(9) || "state unknown"})`);
	}
	if (typeof value === "string" && value.startsWith("CHECK-ERR:")) throw new Error(`${what}: the check threw — ${value.slice(10)}`);
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
	/** Page clock when an armed wait was armed (cold start). */
	armedAt?: number;
}

/** Parse a check result; null for no hit or a malformed value. */
export function parseWaitHit(value: unknown): WaitHit | null {
	if (typeof value !== "string" || value === "") return null;
	try {
		const o = JSON.parse(value) as { detail?: unknown; pageMs?: unknown; checks?: unknown; checkMs?: unknown; armedAt?: unknown };
		if (typeof o.detail === "string" && typeof o.pageMs === "number") {
			const hit: WaitHit = { detail: o.detail, pageMs: o.pageMs };
			if (typeof o.checks === "number") hit.checks = o.checks;
			if (typeof o.checkMs === "number") hit.checkMs = o.checkMs;
			if (typeof o.armedAt === "number") hit.armedAt = o.armedAt;
			return hit;
		}
	} catch {
		/* malformed — treat as no hit */
	}
	return null;
}

/**
 * Install the long-frame observer once per document, and clear the buffer
 * on every NEW install (each call gets a nonce), so a scenario reads only
 * frames from its own window.
 * Observes `long-animation-frame` only (falling back to `longtask` where
 * LoAF is unsupported), so one stall is never counted twice. Each entry
 * keeps its `entryType`, and `styleAndLayoutMs` is computed from the LoAF
 * `styleAndLayoutStart` attribute (the end of the frame minus the start of
 * its rendering style/layout); a longtask entry has no such attribute.
 * `buffered: true` backfills frames from earlier in the document, which is
 * how cold start sees the restore's frames when it installs after reload.
 */
export function observerInstallJs(nonce: string): string {
	// The nonce makes a retried install (after a dropped reply) a no-op for
	// the buffer, so it can't erase frames cold start's backfill delivered.
	return (
	`(function(){if(window.__profInstallNonce!==${JSON.stringify(nonce)}){window.__profInstallNonce=${JSON.stringify(nonce)};window.__profBuf=[];}if(window.__profObs)return window.__profObsType;` +
	"var types=(window.PerformanceObserver&&PerformanceObserver.supportedEntryTypes)||[];" +
	'var type=types.indexOf("long-animation-frame")>=0?"long-animation-frame":(types.indexOf("longtask")>=0?"longtask":"");' +
	'if(!type)return "OBS-ERR:no long-frame entry type";' +
	"try{var po=new PerformanceObserver(function(l){var es=l.getEntries();for(var i=0;i<es.length;i++){var e=es[i];" +
	"var sl=e.styleAndLayoutStart?Math.max(0,e.startTime+e.duration-e.styleAndLayoutStart):0;" +
	"window.__profBuf.push({entryType:e.entryType,duration:e.duration,blockingDuration:e.blockingDuration||0,styleAndLayoutMs:sl,startTime:e.startTime});}});" +
	"po.observe({type:type,buffered:true});window.__profObs=po;window.__profObsType=type;return type;}" +
	'catch(err){return "OBS-ERR:"+err.message;}})()'
	);
}

/** An install with a fixed nonce (tests). */
export const OBSERVER_INSTALL_JS = observerInstallJs("default");

/**
 * Read the buffered entries WITHOUT clearing them (install clears), so a
 * read retried after a dropped reply returns the same frames.
 */
export const OBSERVER_READ_JS =
	"(function(){return (window.__profBuf||[]).slice();})()";
