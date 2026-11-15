/**
 * Chat Timestamps PR 2 — hot-path bar: a streaming flush or a tab-list
 * re-render re-renders no stamp outside the live turn.
 *
 * MessageList re-renders on every streaming flush (a new `messages` array), so
 * a stamp leaf that isn't memoized with primitive props would format again for
 * every finished turn, about 60 times a second on a long transcript. The count
 * comes from a pass-through spy on the formatter each stamp render calls: the
 * real implementation runs, the spy only counts calls. This is instrumentation,
 * not a behavior mock.
 *
 * Spec: [[Agent Console Chat Timestamps]] § Hot-path cost (pass bars).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

const formatSpy = vi.hoisted(() => ({ calls: 0 }));

vi.mock("../../utils/time-format", async () => {
	const actual = await vi.importActual<typeof import("../../utils/time-format")>(
		"../../utils/time-format",
	);
	return {
		...actual,
		formatClock: (...args: Parameters<typeof actual.formatClock>) => {
			formatSpy.calls++;
			return actual.formatClock(...args);
		},
	};
});
vi.mock("../shared/MarkdownRenderer", async () => {
	const React = await import("react");
	return {
		MarkdownRenderer: (props: { text: string }) =>
			React.createElement("div", { className: "test-markdown" }, props.text),
	};
});

import { MessageList } from "../MessageList";
import { localDayStore } from "../../services/local-day-store";
import type { ChatMessage, MessageContent } from "../../types/chat";
import type { IChatViewHost } from "../view-host";
import type AgentClientPlugin from "../../plugin";

const PLUGIN = {
	app: { workspace: { getActiveFile: () => null } },
	settings: { displaySettings: { showEmojis: false } },
} as unknown as AgentClientPlugin;
const VIEW = { registerDomEvent: vi.fn() } as unknown as IChatViewHost;

beforeAll(() => {
	(window as { ResizeObserver?: unknown }).ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});
afterEach(() => {
	cleanup();
	localDayStore.dispose();
});

const T = Date.now();
let n = 0;
function turn(i: number): ChatMessage[] {
	const sent = T - (40 - i) * 60_000;
	return [
		{
			id: `u${++n}`,
			role: "user",
			content: [{ type: "text", text: `prompt ${i}` }],
			timestamp: new Date(sent),
			sentAt: sent,
			turnEndedAt: sent + 30_000,
			turnEndKind: "done",
			turnMs: 30_000,
		},
		{
			id: `a${++n}`,
			role: "assistant",
			content: [{ type: "text", text: `reply ${i}`, arrivedAt: sent + 5_000 } as MessageContent],
			timestamp: new Date(sent),
		},
	];
}

function list(messages: ChatMessage[]) {
	return (
		<MessageList
			messages={messages}
			isSending={true}
			lazyState="ready"
			isRestoringSession={false}
			agentLabel="Kiro"
			plugin={PLUGIN}
			view={VIEW}
			hasActivePermission={false}
		/>
	);
}

describe("stamp re-renders", () => {
	it("a streaming flush re-renders no stamp outside the live turn", () => {
		const finished = [turn(1), turn(2), turn(3)].flat();
		const livePrompt: ChatMessage = {
			id: "live",
			role: "user",
			content: [{ type: "text", text: "now" }],
			timestamp: new Date(T),
			sentAt: T,
		};
		const liveReply = (t: string): ChatMessage => ({
			id: "live-a",
			role: "assistant",
			content: [{ type: "text", text: t, arrivedAt: T + 1_000 } as MessageContent],
			timestamp: new Date(T),
		});
		const { rerender, container } = render(list([...finished, livePrompt, liveReply("a")]));
		expect(container.querySelectorAll(".agent-client-stamp").length).toBeGreaterThan(6);

		formatSpy.calls = 0;
		rerender(list([...finished, livePrompt, liveReply("ab")]));
		rerender(list([...finished, livePrompt, liveReply("abc")]));
		expect(formatSpy.calls).toBe(0);
	});

	it("a tab-list re-render with the same messages re-renders no stamp", () => {
		const messages = [turn(4), turn(5)].flat();
		const { rerender } = render(list(messages));
		formatSpy.calls = 0;
		rerender(list(messages));
		expect(formatSpy.calls).toBe(0);
	});
});
