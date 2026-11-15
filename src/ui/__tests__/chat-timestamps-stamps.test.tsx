/**
 * Chat Timestamps PR 2 — stamps and hover times in the rendered chat.
 *
 * Seam (R2): the real MessageList and MessageBubble rendered from the
 * persisted message shape PR 1 writes. Only the markdown renderer is stubbed,
 * as in message-bubble-a2ui.test.tsx (Obsidian's renderer has no jsdom
 * runtime). Assertions are on the rendered DOM a user or a screen reader gets
 * (R3): stamp text, accessible names, the tooltip text Obsidian reads.
 *
 * The clock and timers are faked and the zone pinned, so midnight and ages are
 * exact. The day store is the real plugin-level instance.
 *
 * Spec: [[Agent Console Chat Timestamps]] § Prompt and turn-end stamps,
 * § Per-output times on hover, § Gap stamps, § Ticker and store (day store).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import * as React from "react";

vi.mock("../shared/MarkdownRenderer", async () => {
	const React = await import("react");
	return {
		MarkdownRenderer: (props: { text: string }) =>
			React.createElement("div", { className: "test-markdown" }, props.text),
	};
});

import { MessageList } from "../MessageList";
import { useDayStoreRegistration } from "../TimeStamp";
import { localDayStore } from "../../services/local-day-store";
import type { ChatMessage, MessageContent } from "../../types/chat";
import type { IChatViewHost } from "../view-host";
import type AgentClientPlugin from "../../plugin";

const PLUGIN = {
	app: { workspace: { getActiveFile: () => null }, vault: { adapter: {} } },
	settings: { displaySettings: { showEmojis: false } },
	mcpAuthManager: { getPending: () => [], onChange: () => () => {} },
} as unknown as AgentClientPlugin;
const VIEW = { registerDomEvent: vi.fn() } as unknown as IChatViewHost;

let savedTz: string | undefined;
beforeAll(() => {
	savedTz = process.env.TZ;
	process.env.TZ = "America/Los_Angeles";
	(window as { ResizeObserver?: unknown }).ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});
afterAll(() => {
	if (savedTz === undefined) delete process.env.TZ;
	else process.env.TZ = savedTz;
});
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
	vi.setSystemTime(local(2026, 11, 15, 9, 49));
});
afterEach(() => {
	cleanup();
	localDayStore.dispose();
	vi.useRealTimers();
});

function local(y: number, mo: number, d: number, h = 0, mi = 0) {
	return new Date(y, mo - 1, d, h, mi).getTime();
}
const at = (h: number, mi: number) => local(2026, 11, 15, h, mi);

let n = 0;
function prompt(text: string, fields: Partial<ChatMessage> = {}): ChatMessage {
	return {
		id: `u${++n}`,
		role: "user",
		content: [{ type: "text", text }],
		timestamp: new Date(),
		...fields,
	};
}
function reply(content: MessageContent[]): ChatMessage {
	return { id: `a${++n}`, role: "assistant", content, timestamp: new Date() };
}
const text = (t: string, arrivedAt: number | null, gapBefore = false): MessageContent =>
	({ type: "text", text: t, arrivedAt, gapBefore }) as MessageContent;
const thought = (t: string, arrivedAt: number | null, gapBefore: boolean): MessageContent =>
	({ type: "agent_thought", text: t, arrivedAt, gapBefore }) as MessageContent;

function show(messages: ChatMessage[]) {
	return render(
		<MessageList
			messages={messages}
			isSending={false}
			lazyState="ready"
			isRestoringSession={false}
			agentLabel="Kiro"
			plugin={PLUGIN}
			view={VIEW}
			hasActivePermission={false}
		/>,
	);
}

function rowOf(container: HTMLElement, id: string): HTMLElement {
	const row = container.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
	if (!row) throw new Error(`no row ${id}`);
	return row;
}

const stamps = (root: ParentNode, variant: string) =>
	Array.from(root.querySelectorAll<HTMLElement>(`.agent-client-stamp-${variant}`));

describe("prompt and turn-end stamps", () => {
	it("a sent prompt shows its send time, and its label is its text", () => {
		const p = prompt("Find out why", { sentAt: at(9, 12) });
		const { container } = show([p]);
		const [s] = stamps(rowOf(container, p.id), "prompt");
		expect(s.textContent).toContain("9:12");
		expect(s.getAttribute("aria-label")).toBe(s.textContent);
		expect(s.dataset.stampLabel).toBe(s.textContent);
		expect(Number(s.dataset.arrivedAt)).toBe(at(9, 12));
	});

	it("a turn that is still running shows no end stamp", () => {
		const p = prompt("go", { sentAt: at(9, 12) });
		const { container } = show([p, reply([text("working", at(9, 13))])]);
		expect(stamps(container, "end")).toHaveLength(0);
	});

	it("a finished turn shows its end time and duration under its last agent message", () => {
		const p = prompt("go", {
			sentAt: at(9, 12),
			turnEndedAt: at(9, 18),
			turnEndKind: "done",
			turnMs: 6 * 60_000,
		});
		const r = reply([text("The test job times out.", at(9, 13))]);
		const { container } = show([p, r]);
		const [s] = stamps(rowOf(container, r.id), "end");
		expect(s.textContent).toContain("9:18");
		expect(s.textContent).toMatch(/· 6m$/);
		expect(stamps(rowOf(container, p.id), "end")).toHaveLength(0);
	});

	it("a stopped turn says so", () => {
		const p = prompt("go", {
			sentAt: at(9, 31),
			turnEndedAt: at(9, 49),
			turnEndKind: "stopped",
			turnMs: 18 * 60_000,
		});
		const r = reply([text("partial", at(9, 32))]);
		const { container } = show([p, r]);
		const [s] = stamps(rowOf(container, r.id), "end");
		expect(s.textContent).toMatch(/^Stopped .*9:49.* · 18m$/);
	});

	it("a failed send with no agent output stamps the prompt; the previous turn's stamp stays put", () => {
		const p1 = prompt("one", { sentAt: at(9, 12), turnEndedAt: at(9, 18), turnEndKind: "done", turnMs: 360_000 });
		const r1 = reply([text("done", at(9, 13))]);
		const p2 = prompt("two", { sentAt: at(9, 40), turnEndedAt: at(9, 40), turnEndKind: "failed", turnMs: 0 });
		const { container } = show([p1, r1, p2]);
		const [failed] = stamps(rowOf(container, p2.id), "end");
		expect(failed.textContent).toMatch(/^Failed .*9:40/);
		expect(failed.textContent).not.toContain("·");
		expect(stamps(rowOf(container, r1.id), "end")[0].textContent).toContain("9:18");
	});

	it("a stamp from an earlier day shows its date", () => {
		const p = prompt("go", { sentAt: local(2026, 11, 14, 9, 12) });
		const { container } = show([p]);
		expect(stamps(container, "prompt")[0].textContent).toContain("14");
	});

	it("an idle chat re-dates its stamps at midnight", () => {
		vi.setSystemTime(local(2026, 11, 15, 23, 58));
		const p = prompt("go", { sentAt: local(2026, 11, 15, 23, 50) });
		const { container } = show([p]);
		const off = localDayStore.register(window, document);
		const s = stamps(container, "prompt")[0];
		expect(s.textContent).not.toContain("15");
		act(() => {
			vi.advanceTimersByTime(3 * 60_000);
		});
		expect(s.textContent).toContain("15");
		expect(s.getAttribute("aria-label")).toBe(s.textContent);
		expect(s.dataset.stampLabel).toBe(s.textContent);
		off();
	});
});

describe("gap stamps", () => {
	it("an item that arrived after a long silence is stamped; others aren't", () => {
		const r = reply([text("first", at(9, 13)), thought("later", at(9, 44), true)]);
		const { container } = show([prompt("go", { sentAt: at(9, 12) }), r]);
		const gaps = stamps(rowOf(container, r.id), "gap");
		expect(gaps).toHaveLength(1);
		expect(gaps[0].textContent).toContain("9:44");
		const thoughtEl = rowOf(container, r.id).querySelector(".agent-client-collapsible-thought");
		expect(gaps[0].compareDocumentPosition(thoughtEl as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});

describe("unknown times show nothing", () => {
	it("history replayed from the agent and chats saved before this feature", () => {
		const replayed = [
			prompt("old", { sentAt: null, turnEndedAt: null }),
			reply([text("old reply", null, false), thought("t", null, false)]),
		];
		const legacy = [prompt("older"), reply([{ type: "text", text: "older reply" }])];
		const { container } = show([...replayed, ...legacy]);
		expect(container.querySelectorAll(".agent-client-stamp")).toHaveLength(0);
	});
});

describe("per-output time on hover", () => {
	it("an agent message's hover row shows when its text began to arrive, next to Copy", () => {
		const r = reply([text("Unit tests pass", at(9, 36))]);
		const { container } = show([prompt("go", { sentAt: at(9, 31) }), r]);
		const actions = rowOf(container, r.id).querySelector(".agent-client-message-actions");
		const [s] = stamps(actions as HTMLElement, "hover");
		expect(s.textContent).toContain("9:36");
		expect(actions?.querySelector("button")).not.toBeNull();
	});

	it("prompts and messages without a known text time have no hover time", () => {
		const p = prompt("go", { sentAt: at(9, 31) });
		const r = reply([text("replayed", null)]);
		const { container } = show([p, r]);
		expect(stamps(container, "hover")).toHaveLength(0);
	});

	it("the reply text keeps its text as its accessible name", () => {
		const r = reply([text("Unit tests pass", at(9, 36))]);
		const { container } = show([prompt("go", { sentAt: at(9, 31) }), r]);
		const md = rowOf(container, r.id).querySelector(".test-markdown") as HTMLElement;
		let el: HTMLElement | null = md;
		while (el && el !== container) {
			expect(el.hasAttribute("aria-label")).toBe(false);
			el = el.parentElement;
		}
	});
});

describe("ages on hover", () => {
	function setup() {
		const p = prompt("go", { sentAt: at(9, 31) });
		const r = reply([text("Unit tests pass", at(9, 36))]);
		const view = show([p, r]);
		const list = view.container.querySelector(".agent-client-chat-view-messages") as HTMLElement;
		const promptStamp = stamps(view.container, "prompt")[0];
		const hoverStamp = stamps(view.container, "hover")[0];
		return { ...view, list, p, r, promptStamp, hoverStamp };
	}

	it("the first hover adds the age to the label; leaving puts the label back", () => {
		const { promptStamp, list } = setup();
		const label = promptStamp.dataset.stampLabel as string;
		fireEvent.mouseOver(promptStamp);
		expect(promptStamp.getAttribute("aria-label")).toBe(`${label} — 18 minutes ago`);
		promptStamp.setAttribute("data-tooltip", "cached");
		fireEvent.mouseOut(promptStamp, { relatedTarget: list });
		expect(promptStamp.getAttribute("aria-label")).toBe(label);
		expect(promptStamp.hasAttribute("data-tooltip")).toBe(false);
	});

	it("moving within the stamp keeps the age; leaving the window restores it", () => {
		const { promptStamp } = setup();
		const label = promptStamp.dataset.stampLabel as string;
		fireEvent.mouseOver(promptStamp);
		fireEvent.mouseOut(promptStamp, { relatedTarget: promptStamp });
		expect(promptStamp.getAttribute("aria-label")).toBe(`${label} — 18 minutes ago`);
		fireEvent.mouseOut(promptStamp, { relatedTarget: null });
		expect(promptStamp.getAttribute("aria-label")).toBe(label);
	});

	it("from one stamp straight to another: the first is restored, the second aged", () => {
		const { promptStamp, hoverStamp } = setup();
		fireEvent.mouseOver(promptStamp);
		fireEvent.mouseOut(promptStamp, { relatedTarget: hoverStamp });
		fireEvent.mouseOver(hoverStamp);
		expect(promptStamp.getAttribute("aria-label")).toBe(promptStamp.dataset.stampLabel);
		expect(hoverStamp.getAttribute("aria-label")).toBe(`${hoverStamp.dataset.stampLabel} — 13 minutes ago`);
	});

	it("a re-render while hovered keeps the age until the pointer leaves", () => {
		const { promptStamp, rerender, p, r, list } = setup();
		const label = promptStamp.dataset.stampLabel as string;
		fireEvent.mouseOver(promptStamp);
		rerender(
			<MessageList
				messages={[p, r]}
				isSending={false}
				lazyState="ready"
				isRestoringSession={false}
				agentLabel="Kiro"
				plugin={PLUGIN}
				view={VIEW}
				hasActivePermission={false}
			/>,
		);
		expect(promptStamp.getAttribute("aria-label")).toBe(`${label} — 18 minutes ago`);
		fireEvent.mouseOut(promptStamp, { relatedTarget: list });
		expect(promptStamp.getAttribute("aria-label")).toBe(label);
	});

	it("after a missed midnight, the first hover shows the new dated label with its age, and re-checks once", () => {
		vi.setSystemTime(local(2026, 11, 14, 23, 0));
		const p = prompt("go", { sentAt: local(2026, 11, 14, 22, 50) });
		const { container } = show([p]);
		const s = stamps(container, "prompt")[0];
		expect(s.textContent).not.toContain("14");
		vi.setSystemTime(local(2026, 11, 15, 8, 0));

		const Orig = Intl.DateTimeFormat;
		let built = 0;
		Intl.DateTimeFormat = function (...args: ConstructorParameters<typeof Orig>) {
			built++;
			return new Orig(...args);
		} as unknown as typeof Intl.DateTimeFormat;
		try {
			fireEvent.mouseOver(s);
			// Asserted after the first hover: later hovers see committed labels anyway.
			expect(s.textContent).toContain("14");
			expect(s.getAttribute("aria-label")).toBe(`${s.textContent} — 9 hours ago`);
			for (let i = 0; i < 49; i++) fireEvent.mouseOver(s);
		} finally {
			Intl.DateTimeFormat = Orig;
		}
		expect(built).toBe(1);
	});

	it("ignores elements that aren't the plugin's own stamps", () => {
		const { list } = setup();
		const make = (attrs: Record<string, string>) => {
			const el = document.createElement("span");
			for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
			list.appendChild(el);
			return el;
		};
		const foreign = make({ "data-arrived-at": String(at(9, 0)), "data-stamp-label": "x" });
		const notNumber = make({ class: "agent-client-stamp", "data-arrived-at": "soon", "data-stamp-label": "x" });
		const noLabel = make({ class: "agent-client-stamp", "data-arrived-at": String(at(9, 0)) });
		for (const el of [foreign, notNumber, noLabel]) {
			fireEvent.mouseOver(el);
			fireEvent.mouseOut(el, { relatedTarget: list });
			expect(el.hasAttribute("aria-label")).toBe(false);
		}
	});
});

describe("each view registers its window with the day store", () => {
	it("re-registers when Obsidian moves the view to another window", () => {
		vi.setSystemTime(local(2026, 11, 15, 9));
		let migrate: ((win: Window) => void) | null = null;
		const container = document.createElement("div") as HTMLElement & {
			onWindowMigrated?: (cb: (win: Window) => void) => () => void;
		};
		container.onWindowMigrated = (cb) => {
			migrate = cb;
			return () => {
				migrate = null;
			};
		};
		const hook = renderHook(() => useDayStoreRegistration(container));
		const popoutDoc = document.implementation.createHTMLDocument("popout");
		const popoutWin = Object.assign(new EventTarget(), { document: popoutDoc }) as unknown as Window;
		act(() => migrate?.(popoutWin));
		vi.setSystemTime(local(2026, 11, 16, 9));
		popoutWin.dispatchEvent(new Event("focus"));
		expect(localDayStore.getSnapshot().bounds.dayStart).toBe(local(2026, 11, 16));
		hook.unmount();
		expect(migrate).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("code review round 1 cases", () => {
	function listEl(view: ReturnType<typeof show>) {
		return view.container;
	}

	it("a time no formatter can print shows no stamp and doesn't crash the tab", () => {
		const p = prompt("go", { sentAt: 1e20 });
		const view = show([p]);
		expect(stamps(listEl(view), "prompt")).toHaveLength(0);
	});

	it("a turn under a second shows its end time alone", () => {
		const p = prompt("go", { sentAt: at(9, 18), turnEndedAt: at(9, 18), turnEndKind: "done", turnMs: 400 });
		const r = reply([text("ok", at(9, 18))]);
		const { container } = show([p, r]);
		const [s] = stamps(rowOf(container, r.id), "end");
		expect(s.textContent).toContain("9:18");
		expect(s.textContent).not.toContain("·");
	});

	it("a stopped turn with no agent output stamps the prompt", () => {
		const p = prompt("go", { sentAt: at(9, 40), turnEndedAt: at(9, 41), turnEndKind: "stopped", turnMs: 60_000 });
		const { container } = show([p]);
		const [s] = stamps(rowOf(container, p.id), "end");
		expect(s.textContent).toMatch(/^Stopped .*9:41.* · 1m$/);
	});

	it("gap stamps on a tool call and a plan", () => {
		const r = reply([
			{
				type: "tool_call",
				toolCallId: "tc1",
				title: "npm test",
				kind: "execute",
				status: "completed",
				arrivedAt: at(9, 30),
				gapBefore: true,
			} as MessageContent,
			{
				type: "plan",
				entries: [{ content: "Free the port", status: "pending", priority: "medium" }],
				arrivedAt: at(9, 44),
				gapBefore: true,
			} as MessageContent,
		]);
		const { container } = show([prompt("go", { sentAt: at(9, 12) }), r]);
		const gaps = stamps(rowOf(container, r.id), "gap").map((g) => g.textContent ?? "");
		expect(gaps).toHaveLength(2);
		expect(gaps[0]).toContain("9:30");
		expect(gaps[1]).toContain("9:44");
	});

	it("a reply that starts with a tool call: the hover time is when its text arrived", () => {
		const r = reply([
			{ type: "tool_call", toolCallId: "tc1", title: "ls", kind: "execute", status: "completed", arrivedAt: at(9, 33) } as MessageContent,
			text("Done", at(9, 36)),
		]);
		const { container } = show([prompt("go", { sentAt: at(9, 31) }), r]);
		expect(stamps(container, "hover")[0].textContent).toContain("9:36");
	});

	it("activating a tab after a missed midnight re-dates its stamps before any hover", () => {
		vi.setSystemTime(local(2026, 11, 14, 23, 0));
		localDayStore.getSnapshot();
		const p = prompt("go", { sentAt: local(2026, 11, 14, 22, 50) });
		const props = {
			messages: [p],
			isSending: false,
			lazyState: "ready" as const,
			isRestoringSession: false,
			agentLabel: "Kiro",
			plugin: PLUGIN,
			view: VIEW,
			hasActivePermission: false,
		};
		const view = render(<MessageList {...props} isActive={false} />);
		vi.setSystemTime(local(2026, 11, 15, 8, 0));
		act(() => {
			view.rerender(<MessageList {...props} isActive={true} />);
		});
		const s = stamps(view.container, "prompt")[0];
		expect(s.textContent).toContain("14");
		expect(s.dataset.stampLabel).toBe(s.textContent);
	});

	it("New Year: an idle chat's Dec 31 stamps gain the year", () => {
		vi.setSystemTime(local(2026, 12, 31, 23, 58));
		const p = prompt("go", { sentAt: local(2026, 12, 31, 23, 50) });
		const { container } = show([p]);
		const off = localDayStore.register(window, document);
		const s = stamps(container, "prompt")[0];
		expect(s.textContent).not.toContain("2026");
		act(() => {
			vi.advanceTimersByTime(3 * 60_000);
		});
		expect(s.textContent).toContain("31");
		expect(s.textContent).toContain("2026");
		off();
	});

	it("a time-zone change re-renders every list in the new zone, with one formatter rebuild", () => {
		vi.setSystemTime(Date.UTC(2026, 10, 15, 17, 49));
		const p1 = prompt("one", { sentAt: Date.UTC(2026, 10, 15, 17, 31) });
		const p2 = prompt("two", { sentAt: Date.UTC(2026, 10, 15, 17, 31) });
		const a = show([p1]);
		const b = show([p2]);
		const before = stamps(a.container, "prompt")[0].textContent ?? "";
		expect(before).toContain("9:31");
		const Orig = Intl.DateTimeFormat;
		let built = 0;
		Intl.DateTimeFormat = function (...args: ConstructorParameters<typeof Orig>) {
			built++;
			return new Orig(...args);
		} as unknown as typeof Intl.DateTimeFormat;
		try {
			process.env.TZ = "Asia/Tokyo";
			act(() => {
				localDayStore.recheck(Date.now());
			});
		} finally {
			Intl.DateTimeFormat = Orig;
		}
		try {
			for (const v of [a, b]) {
				expect(stamps(v.container, "prompt")[0].textContent).toContain("2:31");
			}
			// One zone read, then the three formatters rebuilt once for both lists.
			expect(built).toBe(4);
		} finally {
			process.env.TZ = "America/Los_Angeles";
		}
	});
});
