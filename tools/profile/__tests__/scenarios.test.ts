/**
 * Scenario tests (Gate B-phase2). Each scenario's page JS runs against a
 * jsdom DOM shaped like the plugin's: tab panels (only the active one
 * displayed), message rows, and tabs on the rail (`data-tab-id`) or the top
 * bar. The fake context's `waitFor` evaluates the check once and rejects
 * when it doesn't hold, so a wait that "passes" on the wrong DOM fails here.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SCENARIOS, type ProfileContext } from "../scenarios";
import { armWaitJs, collectArmedJs, parseWaitHit, PRE_HELD, type WaitHit } from "../page-js";
import { HEAVY_MESSAGE_COUNT, HEAVY_TAB_ID, LIGHT_TAB_ID } from "../seed";

function scenario(id: string) {
	const s = SCENARIOS.find((x) => x.id === id);
	if (!s) throw new Error(`no scenario ${id}`);
	return s;
}

function run<T>(js: string): T {
	return new Function(`return ${js}`)() as T;
}

/** Shorten in-page timeouts so a wait that can't hold fails fast in tests. */
function fastTimeouts(js: string): string {
	return js.replace(/fin\(""\);\},\d+\)/g, 'fin("");},50)');
}

/**
 * A ProfileContext whose page JS runs in jsdom. Its reload() mimics a real
 * one: the heavy transcript disappears, the wait is armed with the real
 * page JS, and the transcript comes back asynchronously (unless
 * `reloadKeepsRows`, which models a restore finished before arming).
 */
function fakeCtx(onHit?: (h: WaitHit) => void, opts: { reloadKeepsRows?: boolean } = {}): ProfileContext {
	return {
		evalInPage: <T>(js: string): Promise<T> => Promise.resolve(run<T>(js)),
		act: <T>(js: string): Promise<T> => Promise.resolve(run<T>(fastTimeouts(js))),
		snapshot: () => Promise.resolve({}),
		installObserver: () => Promise.resolve(),
		readObserver: () => Promise.resolve([]),
		reload: (armCheckJs?: string) => {
			const panel = document.querySelector<HTMLElement>(
				`.agent-client-tab-panel[data-for="${HEAVY_TAB_ID}"] .agent-client-chat-view-messages`,
			);
			const saved = panel?.innerHTML ?? "";
			if (panel && !opts.reloadKeepsRows) panel.innerHTML = "";
			if (armCheckJs) run(`(function(){${armWaitJs(armCheckJs)}})()`);
			if (panel && !opts.reloadKeepsRows) window.setTimeout(() => (panel.innerHTML = saved), 5);
			return Promise.resolve();
		},
		collectArmed: async (timeoutMs, what) => {
			const v = await run<Promise<string>>(collectArmedJs(Math.min(timeoutMs, 200)));
			if (v === PRE_HELD) throw new Error(`${what}: already true when the wait was armed`);
			const hit = parseWaitHit(v);
			if (!hit) throw new Error(`timed out waiting for ${what}`);
			onHit?.(hit);
			return hit;
		},
		waitFor: (checkJs, _timeoutMs, what) => {
			const hit = parseWaitHit(run<string>(checkJs));
			if (!hit) return Promise.reject(new Error(`timed out waiting for ${what}`));
			onHit?.(hit);
			return Promise.resolve(hit);
		},
		sleep: () => Promise.resolve(),
		log: () => {},
	};
}

function rows(n: number): string {
	let s = "";
	for (let i = 0; i < n; i++) {
		const role = i % 2 === 0 ? "user" : "assistant";
		s += `<div class="agent-client-message-row"><div class="agent-client-message-${role}">m${i + 1}</div></div>`;
	}
	return s;
}

/**
 * Two tabs (heavy, light) and two panels. Clicking a tab selects it and
 * shows its panel. The heavy panel holds `heavyRows` rows when shown.
 */
function mountTabs(layout: "rail" | "bar", opts: { count?: number; heavyRows?: number } = {}): string[] {
	const count = opts.count ?? 2;
	const heavyRows = opts.heavyRows ?? HEAVY_MESSAGE_COUNT;
	const ids = [HEAVY_TAB_ID, LIGHT_TAB_ID].slice(0, count);
	const clicks: string[] = [];
	const tabs = ids
		.map((id, i) =>
			layout === "rail"
				? `<button role="tab" class="agent-client-tab-rail-key" data-tab-id="${id}" aria-selected="${i === 0}"></button>`
				: `<div role="tab" class="agent-client-tab" aria-selected="${i === 0}"></div>`,
		)
		.join("");
	const panels = ids
		.map(
			(id, i) =>
				`<div class="agent-client-tab-panel" data-for="${id}" style="display: ${i === 0 ? "flex" : "none"}; flex-direction: column;">` +
				`<div class="agent-client-chat-view-messages">${id === HEAVY_TAB_ID ? rows(heavyRows) : rows(2)}</div></div>`,
		)
		.join("");
	document.body.innerHTML = tabs + panels;
	const tabEls = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
	tabEls.forEach((el, i) =>
		el.addEventListener("click", () => {
			clicks.push(ids[i]);
			tabEls.forEach((t, j) => t.setAttribute("aria-selected", String(j === i)));
			document.querySelectorAll<HTMLElement>(".agent-client-tab-panel").forEach((p) => {
				p.style.display = p.dataset.for === ids[i] ? "flex" : "none";
			});
		}),
	);
	return clicks;
}

beforeEach(() => {
	document.body.innerHTML = "";
	(window as unknown as { requestAnimationFrame: (cb: (ts: number) => void) => number }).requestAnimationFrame = (cb) =>
		window.setTimeout(() => cb(performance.now()), 0);
});

describe("activate-background-tab", () => {
	it("parks on the light tab, then activates the heavy tab (rail, by id)", async () => {
		const clicks = mountTabs("rail");
		const m = await scenario("activate-background-tab").measure(fakeCtx());
		expect(clicks).toEqual([LIGHT_TAB_ID, HEAVY_TAB_ID]);
		expect(m.activateMs).toBeGreaterThanOrEqual(0);
		// Timed in the page from the click to the commit and the next frame.
		expect(m.activateFrameMs).toBeGreaterThanOrEqual(m.activateMs);
	});

	it("parks on the light tab, then activates the heavy tab (top bar, by index)", async () => {
		const clicks = mountTabs("bar");
		await scenario("activate-background-tab").measure(fakeCtx());
		expect(clicks).toEqual([LIGHT_TAB_ID, HEAVY_TAB_ID]);
	});

	it("does not accept the empty message container as the heavy transcript", async () => {
		mountTabs("rail", { heavyRows: 0 });
		await expect(scenario("activate-background-tab").measure(fakeCtx())).rejects.toThrow(
			new RegExp(`${HEAVY_MESSAGE_COUNT} rows: timed out`),
		);
	});

	it("throws when there is no second tab to park on", async () => {
		mountTabs("rail", { count: 1 });
		await expect(scenario("activate-background-tab").measure(fakeCtx())).rejects.toThrow(/light tab/);
	});

	it("throws when no tab matches at all", async () => {
		await expect(scenario("activate-background-tab").measure(fakeCtx())).rejects.toThrow(/tab/);
	});
});

describe("cold-start-restore", () => {
	it("records the page clock when the whole heavy transcript is shown", async () => {
		mountTabs("rail");
		let hit: WaitHit | undefined;
		const m = await scenario("cold-start-restore").measure(fakeCtx((h) => (hit = h)));
		expect(hit).toBeDefined();
		expect(m.wallMs).toBe(hit?.pageMs);
	});

	it("does not accept a partial transcript (e.g. the light session restored)", async () => {
		mountTabs("rail", { heavyRows: HEAVY_MESSAGE_COUNT - 1 });
		await expect(scenario("cold-start-restore").measure(fakeCtx())).rejects.toThrow(/restored rows/);
	});

	it("refuses to time a restore that finished before the wait was armed", async () => {
		mountTabs("rail");
		await expect(
			scenario("cold-start-restore").measure(fakeCtx(undefined, { reloadKeepsRows: true })),
		).rejects.toThrow(/already true when the wait was armed/);
	});

	it("records the observer's own cost inside the window", async () => {
		mountTabs("rail");
		const m = await scenario("cold-start-restore").measure(fakeCtx());
		expect(typeof m.waitCheckMs).toBe("number");
	});
});

describe("stream-tokens", () => {
	it("throws when the active panel has no assistant row", async () => {
		document.body.innerHTML =
			'<div class="agent-client-tab-panel" style="display: flex;"><div class="agent-client-message-row"><div class="agent-client-message-user">u</div></div></div>';
		await expect(scenario("stream-tokens").measure(fakeCtx())).rejects.toThrow(/assistant row/);
	});

	it("grows the last assistant row in a temporary span and leaves its markup intact", async () => {
		mountTabs("rail");
		const panel = document.querySelector(".agent-client-tab-panel");
		const before = panel?.innerHTML;
		await scenario("stream-tokens").measure(fakeCtx());
		expect(panel?.innerHTML).toBe(before);
	});
});

describe("scroll-heavy-transcript", () => {
	function stubScroller(el: HTMLElement, opts: { firesScroll: boolean }): void {
		Object.defineProperty(el, "scrollHeight", { configurable: true, value: 5000 });
		Object.defineProperty(el, "clientHeight", { configurable: true, value: 500 });
		let top = 0;
		Object.defineProperty(el, "scrollTop", {
			configurable: true,
			get: () => top,
			set: (v: number) => {
				const changed = v !== top;
				top = v;
				if (changed && opts.firesScroll) el.dispatchEvent(new Event("scroll"));
			},
		});
	}

	beforeEach(() => {
		(window as unknown as { requestAnimationFrame: (cb: () => void) => number }).requestAnimationFrame = (cb) =>
			window.setTimeout(cb, 0);
	});

	it("throws when there is no scroll container", async () => {
		await expect(scenario("scroll-heavy-transcript").measure(fakeCtx())).rejects.toThrow(/scroll container/);
	});

	it("throws when the transcript does not overflow", async () => {
		mountTabs("rail");
		await expect(scenario("scroll-heavy-transcript").measure(fakeCtx())).rejects.toThrow(/scroll container/);
	});

	it("steps the active transcript frame by frame and counts every scroll", async () => {
		mountTabs("rail");
		const sc = document.querySelector<HTMLElement>(
			'.agent-client-tab-panel[style*="flex"] .agent-client-chat-view-messages',
		);
		if (!sc) throw new Error("no scroller");
		stubScroller(sc, { firesScroll: true });
		const m = await scenario("scroll-heavy-transcript").measure(fakeCtx());
		expect(m.scrollEvents).toBe(40);
		expect(sc.scrollTop).toBe(0);
	});

	it("throws when the scroll writes produce no scroll events", async () => {
		mountTabs("rail");
		const sc = document.querySelector<HTMLElement>(
			'.agent-client-tab-panel[style*="flex"] .agent-client-chat-view-messages',
		);
		if (!sc) throw new Error("no scroller");
		stubScroller(sc, { firesScroll: false });
		await expect(scenario("scroll-heavy-transcript").measure(fakeCtx())).rejects.toThrow(/scroll events/);
	});
});
