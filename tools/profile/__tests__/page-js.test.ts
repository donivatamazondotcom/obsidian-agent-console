/**
 * The page JS behind reload + wait. Run in jsdom (the same pure-ASCII
 * expressions the profiler sends over `dev:cdp`).
 *
 * - The cold-start time comes from the page's own `performance.now()` at the
 *   first restored row, i.e. ms since navigation start. It used to be ms
 *   after a fixed 1.5 s post-reload sleep, so any restore under 1.5 s read
 *   as one poll interval (15 ms, 2026-11-15).
 * - Reload waits for the NEW document by a sentinel set on the old one, so
 *   the wait can't match the old document's rows.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
	MARK_OLD_DOCUMENT_JS,
	IS_NEW_DOCUMENT_JS,
	waitCheckJs,
	parseWaitHit,
} from "../page-js";

function run<T>(js: string): T {
	return new Function(`return ${js}`)() as T;
}

beforeEach(() => {
	document.body.innerHTML = "";
	delete (window as unknown as Record<string, unknown>).__profOldDocument;
});

describe("old-document sentinel", () => {
	it("reads the marked document as old, and an unmarked one as new", () => {
		expect(run<boolean>(IS_NEW_DOCUMENT_JS)).toBe(true);
		run(MARK_OLD_DOCUMENT_JS);
		expect(run<boolean>(IS_NEW_DOCUMENT_JS)).toBe(false);
	});
});

describe("waitCheckJs", () => {
	it("returns no hit when nothing matches", () => {
		expect(parseWaitHit(run<string>(waitCheckJs([".row"])))).toBeNull();
	});

	it("returns the matching selector and ms since navigation start", () => {
		document.body.innerHTML = '<div class="row"></div>';
		const hit = parseWaitHit(run<string>(waitCheckJs([".missing", ".row"])));
		expect(hit?.selector).toBe(".row");
		expect(typeof hit?.pageMs).toBe("number");
		expect(hit?.pageMs).toBeGreaterThanOrEqual(0);
	});

	it("is pure ASCII (dev:cdp base64-wraps the expression)", () => {
		expect(/^[\x20-\x7e]*$/.test(waitCheckJs([".agent-client-message-row"]))).toBe(true);
	});
});
