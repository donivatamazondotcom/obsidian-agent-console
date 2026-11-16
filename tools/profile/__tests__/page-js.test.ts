/**
 * The page JS behind reload, waits, tab clicks and the long-frame buffer,
 * run in jsdom (the same pure-ASCII expressions the profiler sends over
 * `dev:cdp`).
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
	PRE_HELD,
	clickAndAwaitJs,
	parseInteraction,
	armWaitJs,
	collectArmedJs,
	armedResultError,
	observerInstallJs,
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
	delete w.__profInstallNonce;
});

describe("old-document sentinel", () => {
	it("reads the marked document as old", () => {
		w.app = { vault: { getName: () => "studio", adapter: { getBasePath: () => "/x" } } };
		expect(run<string>(IS_NEW_DOCUMENT_JS)).not.toBe("");
		run(MARK_OLD_DOCUMENT_JS);
		expect(run<string>(IS_NEW_DOCUMENT_JS)).toBe("");
		delete w.app;
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
	it("clears the buffer on every new install, not only the first", () => {
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
		// A read doesn't clear (a retried read returns the same frames)...
		expect(run<unknown[]>(OBSERVER_READ_JS)).toHaveLength(1);
		expect(run<unknown[]>(OBSERVER_READ_JS)).toHaveLength(1);
		// ...the next install (next scenario, new nonce) does, without a new observer.
		expect(run<string>(observerInstallJs("next-scenario"))).toBe("long-animation-frame");
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

describe("awaitCheckJs cost", () => {
	it("reports how often the check ran and its cost", async () => {
		const p = run<Promise<string>>(awaitCheckJs(waitCheckJs([".row"]), 2000));
		document.body.innerHTML = '<div class="row"></div>';
		const hit = parseWaitHit(await p);
		expect(hit?.checks).toBeGreaterThanOrEqual(2);
		expect(typeof hit?.checkMs).toBe("number");
	});
});

describe("clickAndAwaitJs", () => {
	beforeEach(() => {
		(w as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: (ts: number) => void) =>
			window.setTimeout(() => cb(performance.now()), 0);
	});

	const click = '(function(){var b=document.querySelector("button");if(!b)return -1;var at=performance.now();b.click();return at;})()';

	it("times click -> commit -> frame inside one evaluate", async () => {
		document.body.innerHTML = "<button></button>";
		document.querySelector("button")?.addEventListener("click", () => {
			document.body.insertAdjacentHTML("beforeend", '<div class="done"></div>');
		});
		const t = parseInteraction(await run<Promise<string>>(clickAndAwaitJs(click, waitCheckJs([".done"]), 1000)), "x");
		expect(t.pageMs).toBeGreaterThanOrEqual(t.clickedAt);
		expect(t.frameMs).toBeGreaterThanOrEqual(t.pageMs);
	});

	it("refuses when the condition holds before the click", async () => {
		document.body.innerHTML = '<button></button><div class="done"></div>';
		const v = await run<Promise<string>>(clickAndAwaitJs(click, waitCheckJs([".done"]), 1000));
		expect(() => parseInteraction(v, "x")).toThrow(/already true/);
	});

	it("reports a missing click target and a timeout", async () => {
		expect(() =>
			parseInteraction(
				"NO-TARGET",
				"x",
			),
		).toThrow(/missing/);
		document.body.innerHTML = "<button></button>";
		const v = await run<Promise<string>>(clickAndAwaitJs(click, waitCheckJs([".never"]), 30));
		expect(() => parseInteraction(v, "x")).toThrow(/timed out/);
	});
});

describe("reload sentinel carries the vault identity", () => {
	it("returns the vault on mark, and nothing until the document is new", () => {
		w.app = { vault: { getName: () => "studio", adapter: { getBasePath: () => "/x/studio" } } };
		expect(JSON.parse(run<string>(MARK_OLD_DOCUMENT_JS))).toEqual({ name: "studio", base: "/x/studio" });
		expect(run<string>(IS_NEW_DOCUMENT_JS)).toBe("");
		delete w.__profOldDocument;
		expect(JSON.parse(run<string>(IS_NEW_DOCUMENT_JS))).toEqual({ name: "studio", base: "/x/studio" });
		delete w.app;
	});
});

describe("armed waits (cold start)", () => {
	afterEach(() => {
		delete w.__profArm;
	});

	it("keeps the hit in the page so a retried collect returns the same time", async () => {
		run(`(function(){${armWaitJs(waitCheckJs([".row"]))}})()`);
		document.body.innerHTML = '<div class="row"></div>';
		await Promise.resolve();
		const a = parseWaitHit(await run<Promise<string>>(collectArmedJs(500)));
		const b = parseWaitHit(await run<Promise<string>>(collectArmedJs(500)));
		expect(a).not.toBeNull();
		expect(a?.pageMs).toBe(b?.pageMs);
	});

	it("reports held-at-arming, never armed, a throwing check, and a timeout", async () => {
		w.app = { workspace: { layoutReady: true } };
		expect(await run<Promise<string>>(collectArmedJs(10))).toBe("NO-ARM");
		delete w.app;
		document.body.innerHTML = '<div class="row"></div>';
		run(`(function(){${armWaitJs(waitCheckJs([".row"]))}})()`);
		expect(await run<Promise<string>>(collectArmedJs(10))).toBe(PRE_HELD);
		run(`(function(){${armWaitJs("(function(){throw new Error('bad')})()")}})()`);
		expect(await run<Promise<string>>(collectArmedJs(10))).toBe("CHECK-ERR:bad");
		document.body.innerHTML = "";
		run(`(function(){${armWaitJs(waitCheckJs([".never"]))}})()`);
		expect(await run<Promise<string>>(collectArmedJs(10))).toBe("");
	});
});

describe("clickAndAwaitJs failure modes", () => {
	const click = '(function(){var b=document.querySelector("button");if(!b)return -1;var at=performance.now();b.click();return at;})()';

	it("fails when no frame renders (hidden page) instead of recording 0", async () => {
		delete (w as { requestAnimationFrame?: unknown }).requestAnimationFrame;
		document.body.innerHTML = "<button></button>";
		document.querySelector("button")?.addEventListener("click", () => {
			document.body.insertAdjacentHTML("beforeend", '<div class="done"></div>');
		});
		const v = await run<Promise<string>>(clickAndAwaitJs(click, waitCheckJs([".done"]), 1000));
		expect(() => parseInteraction(v, "x")).toThrow(/no frame/);
	});

	it("fails fast when the check throws", async () => {
		document.body.innerHTML = "<button></button>";
		const v = await run<Promise<string>>(clickAndAwaitJs(click, "(function(){throw new Error('bad')})()", 1000));
		expect(() => parseInteraction(v, "x")).toThrow(/check threw — bad/);
	});
});

describe("round-4 regressions", () => {
	const click = '(function(){var b=document.querySelector("button");if(!b)return -1;var at=performance.now();b.click();return at;})()';
	const mount = () => {
		document.body.innerHTML = "<button></button>";
		document.querySelector("button")?.addEventListener("click", () => {
			document.body.insertAdjacentHTML("beforeend", '<div class="done"></div>');
		});
	};

	it("times the frame AFTER the rAF callback, not by its (earlier) timestamp", async () => {
		// A rAF whose timestamp is the frame START (before the commit), as
		// Chromium's is: the old code recorded it and frameMs < pageMs.
		(w as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: (ts: number) => void) =>
			window.setTimeout(() => cb(0), 0);
		mount();
		const t = parseInteraction(await run<Promise<string>>(clickAndAwaitJs(click, waitCheckJs([".done"]), 1000)), "x");
		expect(t.frameMs).toBeGreaterThanOrEqual(t.pageMs);
	});

	it("fails via the 1 s timer when rAF exists but never fires (hidden page)", async () => {
		(w as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 1;
		mount();
		const v = await run<Promise<string>>(clickAndAwaitJs(click, waitCheckJs([".done"]), 3000));
		expect(() => parseInteraction(v, "x")).toThrow(/no frame rendered within 1 s \(page /);
	});

	it("does not click when the pre-click re-check throws", async () => {
		let clicks = 0;
		document.body.innerHTML = "<button></button>";
		document.querySelector("button")?.addEventListener("click", () => clicks++);
		// The first check (at evaluate start) passes; the pre-click re-check
		// is the second call, and only it throws.
		w.__checkCalls = 0;
		const check = '(function(){if(++window.__checkCalls>=2)throw new Error("bad");return "";})()';
		const v = await run<Promise<string>>(clickAndAwaitJs(click, check, 500));
		expect(v).toMatch(/^CHECK-ERR/);
		expect(clicks).toBe(0);
		delete w.__checkCalls;
	});

	it("records when the wait was armed", async () => {
		delete w.__profArm;
		run(`(function(){${armWaitJs(waitCheckJs([".row"]))}})()`);
		document.body.innerHTML = '<div class="row"></div>';
		await Promise.resolve();
		const hit = parseWaitHit(await run<Promise<string>>(collectArmedJs(500)));
		expect(typeof hit?.armedAt).toBe("number");
		expect(hit?.pageMs).toBeGreaterThanOrEqual(hit?.armedAt ?? Infinity);
		delete w.__profArm;
	});

	it("a retried install (same nonce) keeps the buffer; a new install clears it", () => {
		class FakePO {
			static supportedEntryTypes = ["long-animation-frame"];
			observe() {}
		}
		w.PerformanceObserver = FakePO;
		delete w.__profObs;
		delete w.__profInstallNonce;
		run(observerInstallJs("n1"));
		(w.__profBuf as unknown[]).push({ entryType: "long-animation-frame", duration: 90 });
		run(observerInstallJs("n1"));
		expect(run<unknown[]>(OBSERVER_READ_JS)).toHaveLength(1);
		run(observerInstallJs("n2"));
		expect(run<unknown[]>(OBSERVER_READ_JS)).toEqual([]);
	});
});

describe("round-5 regressions", () => {
	const click = '(function(){var b=document.querySelector("button");if(!b)return -1;var at=performance.now();b.click();return at;})()';

	afterEach(() => {
		vi.useRealTimers();
		delete w.__profArm;
	});

	it("re-checks right before the click: a condition that turns true after the evaluate starts is not timed", async () => {
		(w as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: (ts: number) => void) =>
			window.setTimeout(() => cb(performance.now()), 0);
		let clicks = 0;
		document.body.innerHTML = "<button></button>";
		document.querySelector("button")?.addEventListener("click", () => clicks++);
		const p = run<Promise<string>>(clickAndAwaitJs(click, waitCheckJs([".done"]), 1000));
		// After the evaluate's first check, before its click task runs.
		document.body.insertAdjacentHTML("beforeend", '<div class="done"></div>');
		expect(await p).toBe(PRE_HELD);
		expect(clicks).toBe(0);
	});

	it("arms on a document that has no documentElement yet", async () => {
		const html = document.documentElement;
		document.removeChild(html);
		try {
			expect(() => run(`(function(){${armWaitJs(waitCheckJs([".row"]))}})()`)).not.toThrow();
			(html.querySelector("body") as HTMLElement).innerHTML = '<div class="row"></div>';
			document.appendChild(html);
		} finally {
			if (!document.documentElement) document.appendChild(html);
		}
		await Promise.resolve();
		expect(parseWaitHit(await run<Promise<string>>(collectArmedJs(500)))?.detail).toBe(".row");
	});

	it("times the frame once its rendering is done, not inside the rAF callback", async () => {
		// The fake frame does 5 ms of "style, layout and paint" AFTER the
		// rAF callbacks return, as a real frame does.
		let paintDoneAt = Infinity;
		(w as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: (ts: number) => void) =>
			window.setTimeout(() => {
				cb(performance.now());
				const end = performance.now() + 5;
				while (performance.now() < end) { /* paint */ }
				paintDoneAt = performance.now();
			}, 0);
		document.body.innerHTML = "<button></button>";
		document.querySelector("button")?.addEventListener("click", () => {
			document.body.insertAdjacentHTML("beforeend", '<div class="done"></div>');
		});
		const t = parseInteraction(await run<Promise<string>>(clickAndAwaitJs(click, waitCheckJs([".done"]), 1000)), "x");
		expect(t.frameMs).toBeGreaterThanOrEqual(paintDoneAt);
	});

	it("keeps the cold-start arm alive past a worst-case reload plus collect (60 s)", async () => {
		vi.useFakeTimers();
		run(`(function(){${armWaitJs(waitCheckJs([".row"]))}})()`);
		vi.advanceTimersByTime(61_000);
		document.body.innerHTML = '<div class="row"></div>';
		await Promise.resolve();
		vi.useRealTimers();
		expect(parseWaitHit(await run<Promise<string>>(collectArmedJs(200)))?.detail).toBe(".row");
	});
});

describe("helper-armed collection", () => {
	afterEach(() => {
		delete w.__profArm;
		delete w.app;
	});

	it("waits in the page for the helper to arm, within one collect", async () => {
		const p = run<Promise<string>>(collectArmedJs(1000));
		window.setTimeout(() => {
			run(`(function(){${armWaitJs(waitCheckJs([".row"]))}})()`);
			document.body.innerHTML = '<div class="row"></div>';
		}, 60);
		expect(parseWaitHit(await p)?.detail).toBe(".row");
	});

	it("treats a missing arm as not yet until the layout is ready", async () => {
		expect(await run<Promise<string>>(collectArmedJs(10))).toBe("");
		w.app = { workspace: { layoutReady: false } };
		expect(await run<Promise<string>>(collectArmedJs(10))).toBe("");
		w.app = { workspace: { layoutReady: true } };
		expect(await run<Promise<string>>(collectArmedJs(10))).toBe("NO-ARM");
	});

	it("maps collect results to failures, and passes hits and not-yet through", () => {
		expect(armedResultError("NO-ARM", "rows")).toMatch(/helper plugin did not arm/);
		expect(armedResultError(PRE_HELD, "rows")).toMatch(/already true when the wait was armed/);
		expect(armedResultError("CHECK-ERR:boom", "rows")).toMatch(/check threw — boom/);
		expect(armedResultError("", "rows")).toBeNull();
		expect(armedResultError('{"detail":"x","pageMs":1}', "rows")).toBeNull();
	});
});
