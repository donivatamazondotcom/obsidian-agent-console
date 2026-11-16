/**
 * Chat Timestamps PR 3: the live status line, tool-row times and the ticker,
 * in the rendered chat.
 *
 * Seam (R2): the real MessageList, MessageBubble and ToolCallBlock rendered
 * from the persisted message shape PR 1 writes, inside the per-panel store
 * provider ChatPanel gives them; the ticker hook ChatPanel calls, driven with
 * fake timers. Only the markdown renderer is stubbed. Assertions are on the
 * rendered DOM a user or a screen reader gets (R3). `deriveToolRowTime` is
 * wrapped (not replaced) only to count ToolCallBlock renders for the pass bars.
 *
 * Spec: [[Agent Console Chat Timestamps]] § Live status line, § Tool-call
 * times, § Ticker and store, Decision 12.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import * as React from "react";

vi.mock("../shared/MarkdownRenderer", async () => {
	const React = await import("react");
	return {
		MarkdownRenderer: (props: { text: string }) =>
			React.createElement("div", { className: "test-markdown" }, props.text),
	};
});

vi.mock("../../resolvers/turn-activity", async (importOriginal) => {
	const real = await importOriginal<typeof import("../../resolvers/turn-activity")>();
	return { ...real, deriveToolRowTime: vi.fn(real.deriveToolRowTime) };
});

import { MessageList } from "../MessageList";
import { TurnActivityStoreContext, useTurnActivityTicker } from "../turn-activity-context";
import { createTurnActivityStore, type TurnActivityStore } from "../../services/turn-activity-store";
import { deriveToolRowTime } from "../../resolvers/turn-activity";
import { localDayStore } from "../../services/local-day-store";
import type { ChatMessage, MessageContent } from "../../types/chat";
import type { IChatViewHost } from "../view-host";
import { makeIdleMcpAuthManager, makeMessageListPlugin } from "../../__test_stubs__/message-list-plugin";

const PLUGIN = makeMessageListPlugin({
	app: { workspace: { getActiveFile: () => null }, vault: { adapter: {} } },
	settings: { displaySettings: { showEmojis: false } },
	mcpAuthManager: makeIdleMcpAuthManager(),
});
const VIEW = { registerDomEvent: vi.fn() } as unknown as IChatViewHost;
const rowTimeSpy = vi.mocked(deriveToolRowTime);

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
	vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
	vi.setSystemTime(local(2026, 11, 15, 9, 49));
	rowTimeSpy.mockClear();
});
afterEach(() => {
	cleanup();
	localDayStore.dispose();
	vi.useRealTimers();
});

function local(y: number, mo: number, d: number, h = 0, mi = 0, s = 0) {
	return new Date(y, mo - 1, d, h, mi, s).getTime();
}
const at = (h: number, mi: number, s = 0) => local(2026, 11, 15, h, mi, s);

let n = 0;
function prompt(fields: Partial<ChatMessage> = {}): ChatMessage {
	return { id: `u${++n}`, role: "user", content: [{ type: "text", text: "go" }], timestamp: new Date(), ...fields };
}
function toolMsg(item: Partial<Extract<MessageContent, { type: "tool_call" }>>): ChatMessage {
	return {
		id: `a${++n}`,
		role: "assistant",
		timestamp: new Date(),
		content: [{ type: "tool_call", toolCallId: `tc${n}`, title: "npm test", kind: "execute", status: "completed", ...item } as MessageContent],
	};
}
function textMsg(text: string): ChatMessage {
	return { id: `a${++n}`, role: "assistant", timestamp: new Date(), content: [{ type: "text", text } as MessageContent] };
}

function listElement(messages: ChatMessage[], opts: { isSending?: boolean; hasActivePermission?: boolean } = {}) {
	return (
		<MessageList
			messages={messages}
			isSending={opts.isSending ?? false}
			lazyState="ready"
			isRestoringSession={false}
			agentLabel="Kiro"
			plugin={PLUGIN}
			view={VIEW}
			hasActivePermission={opts.hasActivePermission ?? false}
		/>
	);
}

function show(messages: ChatMessage[], store: TurnActivityStore, opts: { isSending?: boolean; hasActivePermission?: boolean } = {}) {
	const wrap = (m: ChatMessage[], o: typeof opts) => (
		<TurnActivityStoreContext.Provider value={store}>{listElement(m, o)}</TurnActivityStoreContext.Provider>
	);
	const r = render(wrap(messages, opts));
	return { ...r, update: (m: ChatMessage[], o: typeof opts) => r.rerender(wrap(m, o)) };
}

const status = (c: HTMLElement) => c.querySelector(".agent-client-loading-status")?.textContent ?? null;
const rowTime = (c: ParentNode) => c.querySelector(".agent-client-tool-call-time")?.textContent ?? null;
const rowButton = (c: ParentNode) => c.querySelector<HTMLElement>(".agent-client-message-tool-call-summary");
const callsFor = (id: string) => rowTimeSpy.mock.calls.filter(([item]) => item.toolCallId === id).length;

describe("the live status line", () => {
	it("shows Waiting on you from the permission itself, in the same render", () => {
		const store = createTurnActivityStore();
		store.publish({ line: "Working 1m · last update 5s ago", rows: {} });
		const { container } = show([prompt({ sentAt: at(9, 48) })], store, { isSending: true, hasActivePermission: true });
		expect(status(container)).toBe("Waiting on you");
	});

	it("shows the ticker's line otherwise, and nothing when there is none", () => {
		const store = createTurnActivityStore();
		const { container } = show([prompt({ sentAt: at(9, 48) })], store, { isSending: true });
		expect(status(container)).toBeNull();
		act(() => store.publish({ line: "Working 1m · no update yet", rows: {} }));
		expect(status(container)).toBe("Working 1m · no update yet");
	});

	it("puts a running tool's title and the facts in separate spans, so a long title can't hide the facts", () => {
		const store = createTurnActivityStore();
		const { container } = show([prompt({ sentAt: at(9, 48) })], store, { isSending: true });
		const longTitle = "Check the build log for the failing integration test and report back";
		act(() => store.publish({ line: "· 6m · last update 3m ago", lineTitle: longTitle, rows: {} }));
		const slot = container.querySelector(".agent-client-loading-status");
		expect(slot?.querySelector(".agent-client-loading-status-title")?.textContent).toBe(longTitle);
		expect(slot?.querySelector(".agent-client-loading-status-facts")?.textContent).toBe("· 6m · last update 3m ago");
	});

	it("Waiting on you replaces a running tool's title and facts", () => {
		const store = createTurnActivityStore();
		store.publish({ line: "· 6m", lineTitle: "npm test", rows: {} });
		const { container } = show([prompt({ sentAt: at(9, 48) })], store, { isSending: true, hasActivePermission: true });
		expect(status(container)).toBe("Waiting on you");
		expect(container.querySelector(".agent-client-loading-status-facts")).toBeNull();
	});

	it("sits outside the scrolling content, so a tick never resizes it", () => {
		const store = createTurnActivityStore();
		store.publish({ line: "Working 1m · no update yet", rows: {} });
		const { container } = show([prompt({ sentAt: at(9, 48) })], store, { isSending: true });
		const slot = container.querySelector(".agent-client-loading-status");
		expect(slot).not.toBeNull();
		expect(slot?.closest(".agent-client-chat-content")).toBeNull();
	});

	it("never shows the old 'Waiting for permission...' text", () => {
		const store = createTurnActivityStore();
		const { container } = show([prompt()], store, { isSending: true, hasActivePermission: true });
		expect(container.textContent).not.toContain("Waiting for permission");
	});
});

describe("tool-row times", () => {
	it("a finished row shows how long it ran, and its label adds start and end", () => {
		const store = createTurnActivityStore();
		const { container } = show(
			[prompt({ sentAt: at(9, 30), turnEndKind: "done", turnEndedAt: at(9, 40) }), toolMsg({ startedAt: at(9, 34), endedAt: at(9, 35, 52), waitMs: 0 })],
			store,
		);
		expect(rowTime(container)).toBe("1m 52s");
		expect(rowButton(container)?.getAttribute("aria-label")).toContain("Ran 1m 52s, 9:34 AM to 9:35 AM.");
		expect(container.querySelector(".agent-client-tool-call-time")?.getAttribute("aria-hidden")).toBe("true");
	});

	it("a failed row's label says it failed, not that it ran", () => {
		const store = createTurnActivityStore();
		const { container } = show(
			[prompt({ sentAt: at(9, 30), turnEndKind: "done", turnEndedAt: at(9, 40) }), toolMsg({ status: "failed", startedAt: at(9, 34), endedAt: at(9, 34), waitMs: 0 })],
			store,
		);
		const label = rowButton(container)?.getAttribute("aria-label") ?? "";
		expect(label).toContain("Failed, 0s, 9:34 AM to 9:34 AM.");
		expect(label).not.toContain("Ran ");
	});

	it("a finished row from an earlier day prints its date once in the range", () => {
		const store = createTurnActivityStore();
		const day = (h: number, mi: number) => local(2026, 11, 14, h, mi);
		const { container } = show(
			[prompt({ sentAt: day(9, 30), turnEndKind: "done", turnEndedAt: day(9, 40) }), toolMsg({ startedAt: day(9, 34), endedAt: day(9, 36), waitMs: 0 })],
			store,
		);
		expect(rowButton(container)?.getAttribute("aria-label")).toContain("Ran 2m, Nov 14, 9:34 AM to 9:36 AM.");
	});

	it.each([
		["stopped", "Stopped · 1m 10s", "Stopped, 1m 10s."],
		["done", "Open at turn end · 1m 10s", "Open at turn end, 1m 10s."],
		["failed", "Open at turn end · 1m 10s", "Open at turn end, 1m 10s."],
	] as const)("a row its %s turn closed reads %s", (endKind, text, aria) => {
		const store = createTurnActivityStore();
		const { container } = show(
			[
				prompt({ sentAt: at(9, 30), turnEndKind: endKind, turnEndedAt: at(9, 41, 10) }),
				toolMsg({ status: "in_progress", startedAt: at(9, 40), endedAt: at(9, 41, 10), interrupted: true, waitMs: 0 }),
			],
			store,
		);
		expect(rowTime(container)).toBe(text);
		expect(rowButton(container)?.getAttribute("aria-label")).toContain(aria);
		expect(container.querySelector(".agent-client-status-interrupted")).not.toBeNull();
	});

	it("a late completed after the turn closed the row still reads Open at turn end", () => {
		const store = createTurnActivityStore();
		const { container } = show(
			[
				prompt({ sentAt: at(9, 30), turnEndKind: "done", turnEndedAt: at(9, 41, 10) }),
				toolMsg({ status: "completed", startedAt: at(9, 40), endedAt: at(9, 41, 10), interrupted: true, waitMs: 0 }),
			],
			store,
		);
		expect(rowTime(container)).toBe("Open at turn end · 1m 10s");
	});

	it("a running row in the live turn shows the ticker's text and says when it started", () => {
		const store = createTurnActivityStore();
		const row = toolMsg({ status: "in_progress", startedAt: at(9, 48) });
		const id = (row.content[0] as { toolCallId: string }).toolCallId;
		const { container } = show([prompt({ sentAt: at(9, 47) }), row], store, { isSending: true });
		expect(rowTime(container)).toBeNull();
		act(() => store.publish({ line: "· 1m", lineTitle: "npm test", rows: { [id]: "1m · output 2s ago" } }));
		expect(rowTime(container)).toBe("1m · output 2s ago");
		expect(rowButton(container)?.getAttribute("aria-label")).toContain("Open since 9:48 AM.");
	});

	it("a pending row never claims it is running", () => {
		const store = createTurnActivityStore();
		const row = toolMsg({ status: "pending", startedAt: at(9, 48) });
		const { container } = show([prompt({ sentAt: at(9, 47) }), row], store, { isSending: true, hasActivePermission: true });
		const label = rowButton(container)?.getAttribute("aria-label") ?? "";
		expect(label).toContain("Open since 9:48 AM.");
		expect(label.toLowerCase()).not.toContain("running");
	});

	it("a row restored open (no live turn) shows no clock and doesn't subscribe", () => {
		// Baseline: the status line's own subscriptions, with no tool row.
		const baseStore = createTurnActivityStore();
		const baseSubscribe = vi.spyOn(baseStore, "subscribe");
		show([prompt({ sentAt: at(9, 30) })], baseStore);
		const statusLineOnly = baseSubscribe.mock.calls.length;
		cleanup();

		const store = createTurnActivityStore();
		const subscribe = vi.spyOn(store, "subscribe");
		const { container } = show([prompt({ sentAt: at(9, 30) }), toolMsg({ status: "in_progress", startedAt: at(9, 31) })], store);
		expect(rowTime(container)).toBeNull();
		expect(container.querySelector(".agent-client-status-interrupted")).toBeNull();
		expect(subscribe).toHaveBeenCalledTimes(statusLineOnly);
	});

	it("a tick changes the leaf's text without re-rendering the tool row", () => {
		const store = createTurnActivityStore();
		const row = toolMsg({ status: "in_progress", startedAt: at(9, 48) });
		const id = (row.content[0] as { toolCallId: string }).toolCallId;
		const { container } = show([prompt({ sentAt: at(9, 47) }), row], store, { isSending: true });
		act(() => store.publish({ line: "a", rows: { [id]: "1m" } }));
		const before = callsFor(id);
		act(() => store.publish({ line: "b", rows: { [id]: "1m 1s" } }));
		expect(rowTime(container)).toBe("1m 1s");
		expect(callsFor(id)).toBe(before);
	});

	it("at turn end, no tool row outside the ended turn re-renders", () => {
		const store = createTurnActivityStore();
		const p1 = prompt({ sentAt: at(9, 0), turnEndKind: "done", turnEndedAt: at(9, 5) });
		const done = toolMsg({ startedAt: at(9, 1), endedAt: at(9, 2), waitMs: 0 });
		const doneId = (done.content[0] as { toolCallId: string }).toolCallId;
		const p2 = prompt({ sentAt: at(9, 40) });
		const live = toolMsg({ status: "in_progress", startedAt: at(9, 41) });
		const { update } = show([p1, done, textMsg("hi"), p2, live], store, { isSending: true });
		const before = callsFor(doneId);
		const p2Ended = { ...p2, turnEndKind: "done" as const, turnEndedAt: at(9, 49) };
		update([p1, done, textMsg("hi"), p2Ended, live], { isSending: false });
		expect(callsFor(doneId)).toBe(before);
	});

	it("at midnight a row from today re-dates its label; a row from an earlier day doesn't re-render", () => {
		vi.setSystemTime(local(2026, 11, 15, 23, 58));
		const store = createTurnActivityStore();
		const yesterday = (h: number, mi: number) => local(2026, 11, 14, h, mi);
		const old = toolMsg({ startedAt: yesterday(9, 1), endedAt: yesterday(9, 2), waitMs: 0 });
		const oldId = (old.content[0] as { toolCallId: string }).toolCallId;
		const today = toolMsg({ startedAt: local(2026, 11, 15, 23, 50), endedAt: local(2026, 11, 15, 23, 52), waitMs: 0 });
		const { container } = show(
			[prompt({ sentAt: yesterday(9, 0), turnEndKind: "done", turnEndedAt: yesterday(9, 3) }), old, prompt({ sentAt: local(2026, 11, 15, 23, 49), turnEndKind: "done", turnEndedAt: local(2026, 11, 15, 23, 53) }), today],
			store,
		);
		const off = localDayStore.register(window, document);
		const buttons = container.querySelectorAll<HTMLElement>(".agent-client-message-tool-call-summary");
		expect(buttons[1].getAttribute("aria-label")).toContain("Ran 2m, 11:50 PM to 11:52 PM.");
		const before = callsFor(oldId);
		act(() => {
			vi.advanceTimersByTime(3 * 60_000);
		});
		expect(buttons[1].getAttribute("aria-label")).toContain("Ran 2m, Nov 15, 11:50 PM to 11:52 PM.");
		expect(callsFor(oldId)).toBe(before);
		off();
	});
});

describe("useTurnActivityTicker", () => {
	it("ticks at once when the turn starts, then each second, and resets when it stops", () => {
		const store = createTurnActivityStore();
		let k = 0;
		const compute = vi.fn(() => ({ line: `tick ${++k}`, rows: {} }));
		const setIntervalSpy = vi.spyOn(window, "setInterval");
		const { rerender } = renderHook(({ active }) => useTurnActivityTicker(active, store, compute), {
			initialProps: { active: false },
		});
		expect(compute).not.toHaveBeenCalled();
		expect(setIntervalSpy).not.toHaveBeenCalled();

		rerender({ active: true });
		expect(store.getSnapshot().line).toBe("tick 1");
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(store.getSnapshot().line).toBe("tick 2");

		rerender({ active: false });
		expect(store.getSnapshot().line).toBeNull();
		act(() => {
			vi.advanceTimersByTime(5000);
		});
		expect(compute).toHaveBeenCalledTimes(2);
	});

	it("ticks at once when its kick changes, so the line is fresh the moment you answer a permission", () => {
		const store = createTurnActivityStore();
		let line = "Working 9m · last update 8m ago";
		const { rerender } = renderHook(({ kick }) => useTurnActivityTicker(true, store, () => ({ line, rows: {} }), kick), {
			initialProps: { kick: true },
		});
		line = "Working 9m · last update just now";
		rerender({ kick: false });
		expect(store.getSnapshot().line).toBe("Working 9m · last update just now");
	});

	it("publishes the empty snapshot when there is no live turn to read", () => {
		const store = createTurnActivityStore();
		store.publish({ line: "old", rows: { tc1: "1m" } });
		renderHook(() => useTurnActivityTicker(true, store, () => null));
		expect(store.getSnapshot()).toMatchObject({ line: null, rows: {} });
	});

	it("a new turn after a Stop never shows the old line", () => {
		const store = createTurnActivityStore();
		let line = "· 7m · last update 6m ago";
		const { rerender } = renderHook(({ active }) => useTurnActivityTicker(active, store, () => ({ line, rows: {} })), {
			initialProps: { active: true },
		});
		rerender({ active: false });
		line = "Working 0s · no update yet";
		rerender({ active: true });
		expect(store.getSnapshot().line).toBe("Working 0s · no update yet");
	});
});
