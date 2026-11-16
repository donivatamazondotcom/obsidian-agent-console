/**
 * Scenario DOM-targeting tests (Gate B-phase2). The scenarios run JS in the
 * live renderer; a selector that matches nothing used to return `false`,
 * which the scenario only logged, so the run recorded a "measurement" of
 * nothing. These tests run each scenario's page JS against a jsdom DOM.
 *
 * - Tab activation must click tabs in BOTH layouts: the top tab bar
 *   (`.agent-client-tab`) and the vertical rail (`.agent-client-tab-rail-key`,
 *   the new-install default since v2.5.0 and the studio seed's layout).
 * - Every scenario must throw when its target is missing, so the orchestrator
 *   drops it from the profile instead of recording a bogus delta.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SCENARIOS, type ProfileContext } from "../scenarios";

function scenario(id: string) {
	const s = SCENARIOS.find((x) => x.id === id);
	if (!s) throw new Error(`no scenario ${id}`);
	return s;
}

/** A ProfileContext whose evalInPage runs the scenario's JS in jsdom. */
function fakeCtx(): ProfileContext {
	return {
		evalInPage: <T>(js: string): Promise<T> =>
			Promise.resolve(new Function(`return ${js}`)() as T),
		snapshot: () => Promise.resolve({}),
		installObserver: () => Promise.resolve(),
		readObserver: () => Promise.resolve([]),
		reload: () => Promise.resolve(),
		waitForSelector: () =>
			Promise.resolve({ ms: 0, selector: "test", pageMs: 0 }),
		sleep: () => Promise.resolve(),
		log: () => {},
	};
}

/** Mount `count` tabs with `className`; return the click order by index. */
function mountTabs(className: string, count: number): number[] {
	const clicks: number[] = [];
	document.body.innerHTML = "";
	for (let i = 0; i < count; i++) {
		const el = document.createElement("button");
		el.className = className;
		el.addEventListener("click", () => clicks.push(i));
		document.body.appendChild(el);
	}
	return clicks;
}

beforeEach(() => {
	document.body.innerHTML = "";
});

describe("activate-background-tab", () => {
	it("clicks vertical-rail tabs (light tab, then heavy tab)", async () => {
		const clicks = mountTabs("agent-client-tab-rail-key", 2);
		await scenario("activate-background-tab").measure(fakeCtx());
		expect(clicks).toEqual([1, 0]);
	});

	it("clicks top-bar tabs (light tab, then heavy tab)", async () => {
		const clicks = mountTabs("agent-client-tab", 2);
		await scenario("activate-background-tab").measure(fakeCtx());
		expect(clicks).toEqual([1, 0]);
	});

	it("throws when there is no second tab to park on", async () => {
		mountTabs("agent-client-tab-rail-key", 1);
		await expect(
			scenario("activate-background-tab").measure(fakeCtx()),
		).rejects.toThrow(/tab/);
	});

	it("throws when no tab matches at all", async () => {
		await expect(
			scenario("activate-background-tab").measure(fakeCtx()),
		).rejects.toThrow(/tab/);
	});
});

describe("stream-tokens", () => {
	it("throws when there is no message row to stream into", async () => {
		await expect(
			scenario("stream-tokens").measure(fakeCtx()),
		).rejects.toThrow(/message row/);
	});

	it("streams into the last message row and restores its text", async () => {
		document.body.innerHTML =
			'<div class="agent-client-message-row">a</div><div class="agent-client-message-row">b</div>';
		await scenario("stream-tokens").measure(fakeCtx());
		const rows = document.querySelectorAll(".agent-client-message-row");
		expect(rows[1].textContent).toBe("b");
	});
});

describe("scroll-heavy-transcript", () => {
	it("throws when there is no scroll container", async () => {
		await expect(
			scenario("scroll-heavy-transcript").measure(fakeCtx()),
		).rejects.toThrow(/scroll/);
	});

	it("throws when the transcript does not overflow", async () => {
		// jsdom has no layout: scrollHeight === clientHeight === 0.
		document.body.innerHTML =
			'<div class="agent-client-chat-view-messages"></div>';
		await expect(
			scenario("scroll-heavy-transcript").measure(fakeCtx()),
		).rejects.toThrow(/scroll/);
	});
});

describe("cold-start-restore", () => {
	it("waits for a restored message row, not the empty message container", async () => {
		const asked: string[][] = [];
		const ctx = fakeCtx();
		ctx.waitForSelector = (selectors) => {
			asked.push(selectors);
			return Promise.resolve({ ms: 1, selector: selectors[0], pageMs: 1234 });
		};
		const m = await scenario("cold-start-restore").measure(ctx);
		expect(asked).toEqual([[".agent-client-message-row"]]);
		// The page clock (ms since navigation start), not the poll's wall time.
		expect(m.wallMs).toBe(1234);
	});
});
