/**
 * The page JS behind reload, waits, tab clicks and the long-frame buffer,
 * run in jsdom (the same pure-ASCII expressions the profiler sends over
 * `dev:cdp`).
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	MARK_OLD_DOCUMENT_JS,
	IS_NEW_DOCUMENT_JS,
	waitCheckJs,
	awaitCheckJs,
	clickTabJs,
	allChecksJs,
	tabSelectedCheckJs,
	parseWaitHit,
	OBSERVER_INSTALL_JS,
	OBSERVER_READ_JS,
} from "../page-js";

function run<T>(js: string): T {
	return new Function(`return ${js}`)() as T;
}

type W = Record<string, unknown>;
const w = window as unknown as W;

beforeEach(() => {
	document.body.innerHTML = "";
	delete w.__profOldDocument;
	delete w.__profObs;
	delete w.__profObsType;
	delete w.__profBuf;
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
		expect(hit?.detail).toBe(".row");
		expect(hit?.pageMs).toBeGreaterThanOrEqual(0);
	});

	it("holds only once at least minCount elements match", () => {
		document.body.innerHTML = '<div class="row"></div><div class="row"></div>';
		expect(parseWaitHit(run<string>(waitCheckJs([".row"], 3)))).toBeNull();
		document.body.insertAdjacentHTML("beforeend", '<div class="row"></div>');
		expect(parseWaitHit(run<string>(waitCheckJs([".row"], 3)))?.detail).toBe(".row");
	});

	it("is pure ASCII (dev:cdp base64-wraps the expression)", () => {
		expect(/^[\x20-\x7e]*$/.test(waitCheckJs([".agent-client-message-row"], 201))).toBe(true);
		expect(/^[\x20-\x7e]*$/.test(OBSERVER_INSTALL_JS)).toBe(true);
	});
});

describe("awaitCheckJs", () => {
	it("resolves on the mutation that makes the check hold", async () => {
		const p = run<Promise<string>>(awaitCheckJs(waitCheckJs([".row"], 2), 2000));
		document.body.innerHTML = '<div class="row"></div>';
		await Promise.resolve();
		document.body.insertAdjacentHTML("beforeend", '<div class="row"></div>');
		expect(parseWaitHit(await p)?.detail).toBe(".row");
	});

	it("resolves empty on timeout", async () => {
		const p = run<Promise<string>>(awaitCheckJs(waitCheckJs([".row"]), 20));
		expect(await p).toBe("");
	});
});

describe("allChecksJs", () => {
	it("holds only when every check holds", () => {
		const both = allChecksJs([waitCheckJs([".a"]), waitCheckJs([".b"])]);
		document.body.innerHTML = '<div class="a"></div>';
		expect(parseWaitHit(run<string>(both))).toBeNull();
		document.body.insertAdjacentHTML("beforeend", '<div class="b"></div>');
		expect(parseWaitHit(run<string>(both))?.detail).toBe(".b");
	});
});

describe("tab clicks", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("clicks a rail key by data-tab-id, whatever its index", () => {
		const clicks: string[] = [];
		document.body.innerHTML =
			'<button role="tab" class="k" data-tab-id="other"></button>' +
			'<button role="tab" class="k" data-tab-id="light"></button>';
		for (const el of Array.from(document.querySelectorAll("button"))) {
			el.addEventListener("click", () => clicks.push(el.getAttribute("data-tab-id") ?? ""));
		}
		expect(run<number>(clickTabJs(".k", "light", 0))).toBeGreaterThanOrEqual(0);
		expect(clicks).toEqual(["light"]);
	});

	it("falls back to the index when tabs carry no id (top bar)", () => {
		const clicks: number[] = [];
		document.body.innerHTML = '<div class="t"></div><div class="t"></div>';
		document.querySelectorAll(".t").forEach((el, i) => el.addEventListener("click", () => clicks.push(i)));
		expect(run<number>(clickTabJs(".t", "light", 1))).toBeGreaterThanOrEqual(0);
		expect(clicks).toEqual([1]);
		expect(run<number>(clickTabJs(".t", "light", 5))).toBe(-1);
	});

	it("reports selection from aria-selected", () => {
		document.body.innerHTML = '<button role="tab" data-tab-id="h" aria-selected="false"></button>';
		expect(parseWaitHit(run<string>(tabSelectedCheckJs(".x", "h", 0)))).toBeNull();
		document.querySelector("button")?.setAttribute("aria-selected", "true");
		expect(parseWaitHit(run<string>(tabSelectedCheckJs(".x", "h", 0)))?.detail).toBe("selected");
	});
});

describe("long-frame observer", () => {
	it("clears the buffer on every install, not only the first", () => {
		const observed: string[] = [];
		class FakePO {
			static supportedEntryTypes = ["long-animation-frame", "longtask"];
			observe(o: { type: string }) {
				observed.push(o.type);
			}
		}
		w.PerformanceObserver = FakePO;
		expect(run<string>(OBSERVER_INSTALL_JS)).toBe("long-animation-frame");
		(w.__profBuf as unknown[]).push({ entryType: "long-animation-frame", duration: 80 });
		// Second install (next scenario): no new observer, buffer emptied.
		expect(run<string>(OBSERVER_INSTALL_JS)).toBe("long-animation-frame");
		expect(run<unknown[]>(OBSERVER_READ_JS)).toEqual([]);
		// Only LoAF observed: one stall is never counted twice.
		expect(observed).toEqual(["long-animation-frame"]);
	});

	it("computes styleAndLayoutMs from a LoAF entry's styleAndLayoutStart", () => {
		let cb: ((l: { getEntries(): unknown[] }) => void) | null = null;
		class FakePO {
			static supportedEntryTypes = ["long-animation-frame"];
			constructor(f: (l: { getEntries(): unknown[] }) => void) {
				cb = f;
			}
			observe() {}
		}
		w.PerformanceObserver = FakePO;
		run(OBSERVER_INSTALL_JS);
		cb!({
			getEntries: () => [
				{ entryType: "long-animation-frame", startTime: 100, duration: 120, styleAndLayoutStart: 190, blockingDuration: 40 },
				{ entryType: "long-animation-frame", startTime: 400, duration: 60, styleAndLayoutStart: 0, blockingDuration: 0 },
			],
		});
		const buf = run<{ styleAndLayoutMs: number; entryType: string }[]>(OBSERVER_READ_JS);
		expect(buf.map((e) => e.styleAndLayoutMs)).toEqual([30, 0]);
		expect(buf[0].entryType).toBe("long-animation-frame");
	});

	it("falls back to longtask only where LoAF is unsupported", () => {
		const observed: string[] = [];
		class FakePO {
			static supportedEntryTypes = ["longtask"];
			observe(o: { type: string }) {
				observed.push(o.type);
			}
		}
		w.PerformanceObserver = FakePO;
		expect(run<string>(OBSERVER_INSTALL_JS)).toBe("longtask");
		expect(observed).toEqual(["longtask"]);
	});
});
