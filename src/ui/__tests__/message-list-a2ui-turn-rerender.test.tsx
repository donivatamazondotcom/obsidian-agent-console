/**
 * I376: a turn starting or ending must not re-render every message bubble.
 *
 * Turn-level state (sending, queued, restoring, session state, held
 * surface) used to ride on the a2ui context that every bubble receives, so
 * each turn edge gave it a new identity and every memoized bubble re-rendered.
 * This harness runs the real `useA2uiWiring` (the ChatPanel seam) into the
 * real MessageList, with MessageBubble stubbed to count renders per message.
 *
 * Coverage boundary: jsdom counts renders; it cannot time them. The cost
 * removed here is React render work proportional to bubble count, with no
 * layout or paint change, so the render count is the gate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { useRef } from "react";

vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
	setTooltip: vi.fn(),
	Notice: vi.fn(),
	MarkdownRenderer: { render: vi.fn() },
	Component: class {},
	Platform: { isMacOS: true },
}));

const renders = new Map<string, number>();
vi.mock("../MessageBubble", () => ({
	MessageBubble: ({ message }: { message: { id: string } }) => {
		renders.set(message.id, (renders.get(message.id) ?? 0) + 1);
		return <div data-testid="bubble" data-message-id={message.id} />;
	},
}));

import { MessageList } from "../MessageList";
import { useA2uiWiring } from "../../hooks/useA2uiWiring";
import { A2uiTurnStoreContext } from "../a2ui-turn-context";
import { applyTurnEnd } from "../../services/message-state";
import type { ChatMessage, QueuedMessage } from "../../types/chat";
import type { TabSessionState } from "../../types/tab";
import type { IChatViewHost } from "../view-host";
import { makeMessageListPlugin } from "../../__test_stubs__/message-list-plugin";

afterEach(cleanup);

function surfaceFence(surfaceId: string): string {
	const envelope = JSON.stringify({
		version: "v1.0",
		createSurface: {
			surfaceId,
			catalogId: "https://agentconsole.dev/a2ui/catalogs/buttons-v0",
			components: [
				{ id: "root", component: "Row", children: ["b"] },
				{ id: "l", component: "Text", text: "Go" },
				{
					id: "b",
					component: "Button",
					child: "l",
					action: { event: { name: "go", context: {} } },
				},
			],
		},
	});
	return "Pick:\n\n```a2ui\n" + envelope + "\n```\n";
}

function actionFence(surfaceId: string): string {
	return (
		"Selected: Go\n\n```a2ui\n" +
		JSON.stringify({
			version: "v1.0",
			action: {
				name: "go",
				surfaceId,
				sourceComponentId: "b",
				timestamp: "2026-11-16T09:00:00Z",
				context: {},
			},
		}) +
		"\n```"
	);
}

function text(id: string, role: "user" | "assistant", body: string): ChatMessage {
	return { id, role, content: [{ type: "text", text: body }] } as ChatMessage;
}

/**
 * 20 messages: an older answered surface (msg-1, answered by msg-2), the
 * latest surface in an earlier finished turn (msg-3), text-only bubbles,
 * a last prompt at msg-18 and an assistant reply at msg-19.
 */
function makeTranscript(opts: { openToolCall?: boolean } = {}): ChatMessage[] {
	const messages: ChatMessage[] = [
		text("msg-0", "user", "start"),
		text("msg-1", "assistant", surfaceFence("old-1")),
		text("msg-2", "user", actionFence("old-1")),
		text("msg-3", "assistant", surfaceFence("latest-1")),
	];
	for (let i = 4; i < 19; i++) {
		messages.push(text(`msg-${i}`, i % 2 === 0 ? "user" : "assistant", `body ${i}`));
	}
	const last = text("msg-19", "assistant", "reply");
	if (opts.openToolCall) {
		last.content = [
			{ type: "text", text: "reply" },
			{ type: "tool_call", toolCallId: "t1", title: "Read", status: "in_progress" },
		] as ChatMessage["content"];
	}
	messages.push(last);
	return messages;
}

interface HarnessProps {
	messages: ChatMessage[];
	isSending: boolean;
	isQueued?: boolean;
	queuePending?: QueuedMessage | null;
	sessionState?: TabSessionState;
	isRestoringSession?: boolean;
}

const VIEW = { registerDomEvent: vi.fn() } as unknown as IChatViewHost;
const PLUGIN = makeMessageListPlugin();
const DISPATCH = vi.fn();
const SEND = vi.fn(async () => {});

function Harness(props: HarnessProps): React.ReactElement {
	const isQueued = props.isQueued ?? false;
	const sessionState = props.sessionState ?? "ready";
	const isRestoringSession = props.isRestoringSession ?? false;
	const lazyStateRef = useRef(sessionState);
	const isSendingRef = useRef(props.isSending);
	const isQueuedRef = useRef(isQueued);
	const loadingRef = useRef(isRestoringSession);
	const sendRef = useRef(SEND);
	const { context, turnStore } = useA2uiWiring({
		messages: props.messages,
		isSending: props.isSending,
		isQueued,
		queuePending: props.queuePending ?? null,
		sessionState,
		isRestoringSession,
		queueDispatch: DISPATCH,
		lazyStateRef,
		isSendingRef,
		isQueuedRef,
		sessionHistoryLoadingRef: loadingRef,
		handleSendMessageRef: sendRef,
		refocusComposer: () => {},
	});
	return (
		<A2uiTurnStoreContext.Provider value={turnStore}>
			<div>
				<MessageList
					messages={props.messages}
					isSending={props.isSending}
					lastTurnEnd={null}
					lazyState={sessionState}
					isRestoringSession={isRestoringSession}
					agentLabel="Test Agent"
					hasActivePermission={false}
					view={VIEW}
					plugin={PLUGIN}
					isActive={true}
					a2ui={context}
				/>
			</div>
		</A2uiTurnStoreContext.Provider>
	);
}

function rerenderedSince(before: Map<string, number>): string[] {
	return Array.from(renders.entries())
		.filter(([id, n]) => n > (before.get(id) ?? 0))
		.map(([id]) => id)
		.sort();
}

describe("I376 — turn edges do not re-render every bubble", () => {
	beforeEach(() => {
		renders.clear();
		(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
	});

	it("turn start and turn end re-render only the last bubble when no message changes", () => {
		const messages = makeTranscript();
		const { rerender } = render(<Harness messages={messages} isSending={false} />);
		expect(renders.size).toBe(20);

		let before = new Map(renders);
		act(() => rerender(<Harness messages={messages} isSending={true} />));
		// msg-19 is the last assistant message, so its streaming flag flips.
		expect(rerenderedSince(before)).toEqual(["msg-19"]);

		before = new Map(renders);
		act(() => rerender(<Harness messages={messages} isSending={false} />));
		expect(rerenderedSince(before)).toEqual(["msg-19"]);
	});

	it("queue, session-state and history-load changes re-render no bubble", () => {
		const messages = makeTranscript();
		const { rerender } = render(<Harness messages={messages} isSending={false} />);
		const steps: HarnessProps[] = [
			{ messages, isSending: false, isQueued: true },
			{
				messages,
				isSending: false,
				isQueued: true,
				queuePending: { content: "x", detachedSurfaceId: "latest-1" },
			},
			{ messages, isSending: false, sessionState: "connecting" },
			{ messages, isSending: false, sessionState: "released" },
			{ messages, isSending: false, isRestoringSession: true },
			{ messages, isSending: false },
		];
		for (const step of steps) {
			const before = new Map(renders);
			act(() => rerender(<Harness {...step} />));
			expect(rerenderedSince(before)).toEqual([]);
		}
	});

	it("a real turn end re-renders only the replaced prompt and the closed tool-call reply", () => {
		const messages = makeTranscript({ openToolCall: true });
		const { rerender } = render(<Harness messages={messages} isSending={true} />);
		const ended = applyTurnEnd(messages, {
			promptId: "msg-18",
			now: Date.now(),
			kind: "done",
			waitMs: 0,
		});
		// applyTurnEnd replaced exactly the prompt and the open-call reply.
		expect(ended.filter((m, i) => m !== messages[i]).map((m) => m.id)).toEqual([
			"msg-18",
			"msg-19",
		]);
		const before = new Map(renders);
		act(() => rerender(<Harness messages={ended} isSending={false} />));
		expect(rerenderedSince(before)).toEqual(["msg-18", "msg-19"]);
	});
});
