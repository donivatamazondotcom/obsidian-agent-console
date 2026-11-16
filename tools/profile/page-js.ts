/**
 * Page JS for reload + wait, kept pure so it runs in jsdom tests. Each
 * expression is pure ASCII and self-contained: run-profile.ts base64-wraps
 * it and sends it as one `Runtime.evaluate` over `obsidian dev:cdp`.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2.
 */

/** Mark the current document so a later check can tell it from its reload. */
export const MARK_OLD_DOCUMENT_JS =
	"(function(){window.__profOldDocument=true;return true;})()";

/** True once the marked document has been replaced by a fresh one. */
export const IS_NEW_DOCUMENT_JS =
	"(function(){return window.__profOldDocument!==true;})()";

/**
 * Return `""` when no selector matches, else a JSON string with the matching
 * selector and `performance.now()` (ms since this document's navigation
 * start). Resolution is one poll: one `dev:cdp` round-trip.
 */
export function waitCheckJs(selectors: string[]): string {
	return (
		`(function(){var s=${JSON.stringify(selectors)};` +
		`for(var i=0;i<s.length;i++){if(document.querySelector(s[i]))` +
		`return JSON.stringify({selector:s[i],pageMs:Math.round(performance.now())});}` +
		`return "";})()`
	);
}

export interface WaitHit {
	selector: string;
	pageMs: number;
}

/** Parse a {@link waitCheckJs} result; null for no hit or a malformed value. */
export function parseWaitHit(value: unknown): WaitHit | null {
	if (typeof value !== "string" || value === "") return null;
	try {
		const o = JSON.parse(value) as { selector?: unknown; pageMs?: unknown };
		if (typeof o.selector === "string" && typeof o.pageMs === "number") {
			return { selector: o.selector, pageMs: o.pageMs };
		}
	} catch {
		/* malformed — treat as no hit */
	}
	return null;
}
