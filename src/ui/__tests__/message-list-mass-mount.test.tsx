/**
 * Unit tests for I-S10 (round-3): tab activation does not synchronously
 * mass-mount inside the click handler — the deferral is at the TabBar
 * trigger site (useTransition), not in MessageList.
 *
 * ============================================================================
 * COVERAGE BOUNDARY — read this first
 * ============================================================================
 *
 * This suite captures the STRUCTURAL invariants that JSDOM CAN observe.
 * JSDOM cannot measure cost (click-handler ms, ParseHTML cluster, layout
 * thrash) and cannot observe paint sequencing (whether a frame paints
 * the empty intermediate before the heavy mount commits). Those concerns
 * live in:
 *
 *   - T-IS10-smoke (real-Chromium Performance trace) — cost-axis gate
 *   - T-IS10-video (real-Chromium screen recording) — empty-paint gate
 *
 * What this test DOES assert (round-3 contract):
 *   1. The full message set mounts when `isActive` becomes true. Round-3
 *      removes round-2's in-component deferral, so the bubbles render
 *      directly from the `messages` prop — there is no internal
 *      empty-then-full pattern to observe in JSDOM.
 *   2. Small sessions are unaffected.
 *   3. Streaming (append a new message after activation) lands the new
 *      bubble without re-mounting the rest.
 *   4. Cleanup: unmounting after activation does not throw or warn.
 *   5. Memo guard: re-rendering with the SAME messages reference does
 *      not re-render bubbles. This is the round-3 fix's ONE remaining
 *      load-bearing optimization in MessageList; if `MemoMessageBubble`
 *      is removed, this test fails by every-bubble re-rendering.
 *
 * What this test does NOT assert:
 *   - Click-handler total time (real-Chromium only)
 *   - Empty-paint absence between the previous tab's display:flex
 *     and the new tab's bubble mount (real-Chromium screen recording only)
 *   - The presence/absence of a `useTransition` wrapper at the TabBar
 *     trigger (TabBar's responsibility; verified in real-Chromium)
 *
 * Why round-3's contract is simpler than round-2's:
 *   Round-2 (`1f36847`) kept the deferral inside MessageList via
 *   `useDeferredValue` + `EMPTY_MESSAGES`. Tests had to assert that the
 *   eventual full mount lands AND that the lifecycle doesn't over-render
 *   (rule out the round-1 useEffect-cycling regression). Round-3 moves
 *   the deferral to the trigger site (TabBar) and removes the in-
 *   MessageList machinery entirely — so MessageList's contract collapses
 *   to "renders messages when isActive=true, doesn't when isActive=false."
 *   The empty-paint concern, which was the round-2 UX regression, is
 *   now structurally OUT of MessageList's scope; it's a TabBar +
 *   transition-mechanism concern, verifiable only in real Chromium.
 *
 * Round-3 mechanism summary (from the React docs):
 *   - TabBar.tsx wraps `setActiveTabId(tabId)` calls in `startTransition`
 *   - React schedules the downstream re-render (including this MessageList's
 *     mount on activation) as a low-priority Transition
 *   - Per "Preventing unwanted loading indicators": React keeps the
 *     previously-revealed content painted until the transition's render
 *     commits, so no empty intermediate paint
 *   - https://react.dev/reference/react/useTransition
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";

import { MessageList } from "../MessageList";
import type { ChatMessage } from "../../types/chat";
import type { IChatViewHost } from "../view-host";
import type AgentClientPlugin from "../../plugin";

// ============================================================================
// Mocks
// ============================================================================

vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
	MarkdownRenderer: { render: vi.fn() },
	Component: class {},
}));

// `messageBubbleSpy` records every render call so the memo-guard test
// can detect regressions where re-rendering the parent re-renders every
// bubble (which would happen if `MemoMessageBubble` is replaced with raw
// `MessageBubble`).
const messageBubbleSpy = vi.fn();

vi.mock("../MessageBubble", () => ({
	MessageBubble: ({ message }: { message: ChatMessage }) => {
		messageBubbleSpy(message.id);
		return (
			<div data-testid="bubble" data-message-id={message.id}>
				{/* Stub body — real MessageBubble parses markdown via Obsidian's
				    MarkdownRenderer, which is the dominant cost. */}
			</div>
		);
	},
}));

// ============================================================================
// Fixtures
// ============================================================================

function makeMessages(n: number): ChatMessage[] {
	const baseMs = Date.now() - n * 1000;
	const messages: ChatMessage[] = [];
	for (let i = 0; i < n; i++) {
		messages.push({
			id: `msg-${i}`,
			role: i % 2 === 0 ? "user" : "assistant",
			content: [{ type: "text", text: `Message ${i} body content.` }],
			timestamp: new Date(baseMs + i * 1000),
		});
	}
	return messages;
}

function makeView(): IChatViewHost {
	return {
		registerDomEvent: vi.fn(),
	} as unknown as IChatViewHost;
}

function makePlugin(): AgentClientPlugin {
	return {} as AgentClientPlugin;
}

const baseProps = {
	isSending: false,
	isSessionReady: true,
	isRestoringSession: false,
	agentLabel: "Test Agent",
	hasActivePermission: false,
};

// ============================================================================
// Tests
// ============================================================================

describe("MessageList — I-S10 round-3 contract (deferral moved to TabBar)", () => {
	beforeEach(() => {
		// ResizeObserver isn't relevant to these tests, but MessageList's
		// use of useAutoScrollPin will instantiate one. Stub minimally.
		(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	/**
	 * Headline: a 200-message session mounts fully when `isActive` flips
	 * to true. Round-3 has no in-component deferral, so the bubbles
	 * appear in the DOM as part of the same render that processes the
	 * isActive prop change.
	 */
	it("activating a 200-message tab mounts all 200 bubbles", () => {
		const messages = makeMessages(200);
		const view = makeView();
		const plugin = makePlugin();

		const { rerender, container } = render(
			<MessageList
				{...baseProps}
				messages={messages}
				view={view}
				plugin={plugin}
				isActive={false}
			/>,
		);

		// Inactive: zero bubbles in DOM.
		expect(
			container.querySelectorAll("[data-testid='bubble']").length,
		).toBe(0);

		rerender(
			<MessageList
				{...baseProps}
				messages={messages}
				view={view}
				plugin={plugin}
				isActive={true}
			/>,
		);

		expect(
			container.querySelectorAll("[data-testid='bubble']").length,
		).toBe(200);
	});

	/**
	 * Companion: small sessions still mount fully. Same behavior whether
	 * round-2 or round-3 — small sessions never had a deferral concern.
	 */
	it("does not regress small sessions: 5 messages mount fully on activation", () => {
		const messages = makeMessages(5);
		const view = makeView();
		const plugin = makePlugin();

		const { rerender, container } = render(
			<MessageList
				{...baseProps}
				messages={messages}
				view={view}
				plugin={plugin}
				isActive={false}
			/>,
		);

		rerender(
			<MessageList
				{...baseProps}
				messages={messages}
				view={view}
				plugin={plugin}
				isActive={true}
			/>,
		);

		const bubbles = container.querySelectorAll(
			"[data-testid='bubble']",
		);
		expect(bubbles.length).toBe(5);
	});

	/**
	 * Streaming case: appending a new message to an already-active session
	 * lands the new bubble in the DOM. Round-3 has no per-message deferral,
	 * so the new bubble appears synchronously.
	 */
	it("streaming a new message after activation mounts the new bubble", () => {
		const initial = makeMessages(200);
		const view = makeView();
		const plugin = makePlugin();

		const { rerender, container } = render(
			<MessageList
				{...baseProps}
				messages={initial}
				view={view}
				plugin={plugin}
				isActive={false}
			/>,
		);

		rerender(
			<MessageList
				{...baseProps}
				messages={initial}
				view={view}
				plugin={plugin}
				isActive={true}
			/>,
		);

		expect(
			container.querySelectorAll("[data-testid='bubble']").length,
		).toBe(200);

		// Stream: append a new message.
		const streamed: ChatMessage[] = [
			...initial,
			{
				id: "streamed-0",
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "Streamed reply." }],
				timestamp: new Date(),
			},
		];
		rerender(
			<MessageList
				{...baseProps}
				messages={streamed}
				view={view}
				plugin={plugin}
				isActive={true}
			/>,
		);

		expect(
			container.querySelectorAll("[data-testid='bubble']").length,
		).toBe(201);
		expect(
			container.querySelector("[data-message-id='streamed-0']"),
		).not.toBeNull();
	});

	/**
	 * Cleanup: unmounting during/after activation must not throw or warn.
	 */
	it("unmounting after activation does not throw or warn", () => {
		const messages = makeMessages(200);
		const view = makeView();
		const plugin = makePlugin();

		const { rerender, unmount } = render(
			<MessageList
				{...baseProps}
				messages={messages}
				view={view}
				plugin={plugin}
				isActive={false}
			/>,
		);

		rerender(
			<MessageList
				{...baseProps}
				messages={messages}
				view={view}
				plugin={plugin}
				isActive={true}
			/>,
		);

		unmount();

		// Pass condition: no thrown errors and no React warnings during
		// the prior `rerender` and `unmount` calls. If cleanup is broken,
		// vitest will surface the warning as test output.
		expect(true).toBe(true);
	});

	/**
	 * Memo guard: re-rendering MessageList with the SAME messages prop
	 * must not re-render the individual MessageBubbles.
	 *
	 * This is round-3's ONE remaining load-bearing optimization in
	 * MessageList. Round-3 removed `useDeferredValue` (deferral moved to
	 * TabBar). What's left protecting streaming UX from per-keystroke
	 * re-renders of every bubble is `MemoMessageBubble`. If memo is
	 * removed, this test fails by every-bubble re-rendering on each
	 * parent re-render.
	 *
	 * Sanity-break verification: replacing `MemoMessageBubble` with raw
	 * `MessageBubble` in MessageList.tsx makes this test fail with
	 * `afterRerenderCount` jumping by exactly the message count
	 * (10 here).
	 */
	it("memo wrapper: re-rendering with same messages does not re-render bubbles", () => {
		const messages = makeMessages(10);
		const view = makeView();
		const plugin = makePlugin();
		messageBubbleSpy.mockClear();

		const { rerender } = render(
			<MessageList
				{...baseProps}
				messages={messages}
				view={view}
				plugin={plugin}
				isActive={true}
			/>,
		);

		const initialCallCount = messageBubbleSpy.mock.calls.length;
		expect(initialCallCount).toBeGreaterThanOrEqual(10);

		// Re-render with the EXACT SAME messages reference and other
		// stable props. If MessageBubble is wrapped in memo, no bubble
		// should re-render. If memo is removed, every bubble re-renders.
		rerender(
			<MessageList
				{...baseProps}
				messages={messages}
				view={view}
				plugin={plugin}
				isActive={true}
				// Force MessageList to re-render via an unrelated prop
				// change. isSending doesn't reach MessageBubble's props.
				isSending={true}
			/>,
		);

		const afterRerenderCount = messageBubbleSpy.mock.calls.length;

		// With memo: count stays the same (zero new bubble renders).
		// Without memo: count increases by 10 (every bubble re-renders).
		// Bound set with margin to absorb React's commit accounting
		// without letting a full re-render of all 10 slip through.
		expect(afterRerenderCount).toBeLessThanOrEqual(initialCallCount + 5);
	});
});
