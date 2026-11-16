/**
 * Working face in the rendered chat: the face replaces the nine dots, and the
 * indicator's classes follow the turn (working, happy or close exit, hidden).
 *
 * Seam: the real MessageList inside the per-panel activity store provider,
 * as ChatPanel renders it; only the markdown renderer is stubbed. Fake timers
 * drive the exit. Assertions are on the rendered DOM (R3).
 *
 * Spec: [[Agent Console Working Face]] § Exit phases, § Test Cases 3.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";

vi.mock("../shared/MarkdownRenderer", async () => {
	const React = await import("react");
	return {
		MarkdownRenderer: (props: { text: string }) =>
			React.createElement("div", { className: "test-markdown" }, props.text),
	};
});

import { MessageList } from "../MessageList";
import { TurnActivityStoreContext } from "../turn-activity-context";
import { createTurnActivityStore } from "../../services/turn-activity-store";
import { localDayStore } from "../../services/local-day-store";
import type { ChatMessage } from "../../types/chat";
import type { TurnEnd } from "../../types/session";
import type { IChatViewHost } from "../view-host";
import { makeIdleMcpAuthManager, makeMessageListPlugin } from "../../__test_stubs__/message-list-plugin";

const PLUGIN = makeMessageListPlugin({
	app: { workspace: { getActiveFile: () => null }, vault: { adapter: {} } },
	settings: { displaySettings: { showEmojis: false } },
	mcpAuthManager: makeIdleMcpAuthManager(),
});
const VIEW = { registerDomEvent: vi.fn() } as unknown as IChatViewHost;

beforeAll(() => {
	(window as { ResizeObserver?: unknown }).ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] }));
afterEach(() => {
	cleanup();
	localDayStore.dispose();
	vi.useRealTimers();
});

const MSGS: ChatMessage[] = [
	{ id: "u1", role: "user", content: [{ type: "text", text: "go" }], timestamp: new Date() },
];

function show(isSending: boolean, lastTurnEnd: TurnEnd | null) {
	const store = createTurnActivityStore();
	const el = (s: boolean, t: TurnEnd | null) => (
		<TurnActivityStoreContext.Provider value={store}>
			<MessageList
				messages={MSGS}
				isSending={s}
				lastTurnEnd={t}
				lazyState="ready"
				isRestoringSession={false}
				agentLabel="Kiro"
				plugin={PLUGIN}
				view={VIEW}
				hasActivePermission={false}
			/>
		</TurnActivityStoreContext.Provider>
	);
	const r = render(el(isSending, lastTurnEnd));
	return { ...r, update: (s: boolean, t: TurnEnd | null) => r.rerender(el(s, t)) };
}

const indicator = (c: HTMLElement) => c.querySelector<HTMLElement>(".agent-client-loading-indicator")!;
const T0: TurnEnd = { seq: 1, outcome: "endTurn" };

describe("the working face", () => {
	it("replaces the nine dots with the face (head + six eye layers)", () => {
		const { container } = show(true, T0);
		expect(container.querySelector(".agent-client-loading-dot")).toBeNull();
		const face = container.querySelector(".agent-client-loading-indicator .agent-client-working-face");
		expect(face).not.toBeNull();
		expect(face!.querySelectorAll(".agent-client-face-layer")).toHaveLength(6);
		expect(face!.querySelector(".agent-client-face-head")).not.toBeNull();
		expect(face!.getAttribute("aria-hidden")).toBe("true");
	});

	it("is shown while sending and hidden when idle", () => {
		const { container, update } = show(false, T0);
		expect(indicator(container).classList.contains("agent-client-hidden")).toBe(true);
		update(true, T0);
		expect(indicator(container).classList.contains("agent-client-hidden")).toBe(false);
	});

	it("a successful turn end plays the happy exit, then hides", () => {
		const { container, update } = show(false, T0);
		update(true, T0);
		update(false, { seq: 2, outcome: "endTurn" });
		const ind = indicator(container);
		expect(ind.classList.contains("agent-client-indicator-exit-happy")).toBe(true);
		expect(ind.classList.contains("agent-client-hidden")).toBe(false);
		act(() => vi.advanceTimersByTime(1140));
		expect(ind.classList.contains("agent-client-indicator-exit-happy")).toBe(false);
		expect(ind.classList.contains("agent-client-hidden")).toBe(true);
	});

	it("a failed turn end closes the eyes, then hides", () => {
		const { container, update } = show(false, T0);
		update(true, T0);
		update(false, { seq: 2, outcome: "failed" });
		const ind = indicator(container);
		expect(ind.classList.contains("agent-client-indicator-exit-close")).toBe(true);
		act(() => vi.advanceTimersByTime(320));
		expect(ind.classList.contains("agent-client-hidden")).toBe(true);
	});
});
