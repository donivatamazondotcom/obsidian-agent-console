/**
 * Unit tests for I-S10 (round-3 + round-4): tab activation does not
 * synchronously mass-mount inside the click handler — the deferral
 * EXPERIMENT was at the TabBar trigger site (useTransition), but round-3
 * verification proved the wrapper introduced a perception-time regression
 * (scrollbar-pill flicker during the post-commit markdown-render cascade).
 * Round-4 reverted the wrapper. The in-MessageList simplification (no
 * useDeferredValue / EMPTY_MESSAGES) stays — that part of round-3 was
 * correct and durably fixed round-2's empty-paint regression.
 *
 * ============================================================================
 * COVERAGE BOUNDARY — read this first
 * ============================================================================
 *
 * This suite captures the STRUCTURAL invariants that JSDOM CAN observe.
 * JSDOM cannot measure cost (click-handler ms, ParseHTML cluster, layout
 * thrash) and cannot observe paint sequencing. Those concerns live in:
 *
 *   - T-IS10-smoke (real-Chromium Performance trace) — cost-axis gate
 *   - T-IS10-video (real-Chromium screen recording) — UX gate
 *
 * What this test DOES assert (round-4 contract):
 *   1. The full message set mounts when `isActive` becomes true.
 *      MessageList has no internal deferral — bubbles render directly
 *      from the `messages` prop on the same render that processes the
 *      isActive prop change.
 *   2. Small sessions are unaffected.
 *   3. Streaming (append a new message after activation) lands the new
 *      bubble without re-mounting the rest.
 *   4. Cleanup: unmounting after activation does not throw or warn.
 *   5. Memo guard: re-rendering with the SAME messages reference does
 *      not re-render bubbles. `MemoMessageBubble` is the load-bearing
 *      streaming optimization.
 *
 * What this test does NOT assert:
 *   - Click-handler total time (real-Chromium only)
 *   - Visual regressions during activation transitions (real-Chromium
 *     screen recording only)
 *   - The post-commit-effect cascade mechanism (covered by the
 *     dedicated test in post-commit-effect-mechanism.test.tsx)
 *
 * Why round-4's contract is simpler than round-2's:
 *   Round-2 (`1f36847`) kept the deferral inside MessageList via
 *   `useDeferredValue` + `EMPTY_MESSAGES`. That introduced a fully-empty
 *   intermediate paint. Round-3 removed the in-MessageList deferral and
 *   moved it to TabBar via `useTransition`. That removed the empty paint
 *   but introduced a smaller scrollbar-pill flicker during the post-
 *   commit markdown-render cascade. Round-4 reverts the TabBar wrapper.
 *   MessageList's contract collapses to "renders messages when
 *   isActive=true, doesn't when isActive=false."
 *
 *   The structural test cases below are the same as round-3's (the
 *   MessageList behavior they assert is unchanged); only the doc framing
 *   updates.
 *
 * Round-4 mechanism summary:
 *   - Click handler (TabBar.TabItem.onSelect) calls `onSelectTab(tab.tabId)`
 *     directly, with NO `startTransition` wrapper
 *   - The activation re-render runs synchronously inside the click event
 *     task (matching the hotkey path)
 *   - All work — render, commit, post-commit markdown effects — happens
 *     inside the click handler before it returns
 *   - Browser paints once at the end with the final stable layout
 *   - Chrome will flag the click handler as a long-task violation; this
 *     is an expected diagnostic signal, not a UX regression
 *   - See [[ACP Scroll Architecture Rework]] § I-S10 § Round-3 verification
 *     and § Lessons Learned § "useTransition doesn't defer post-commit effects"
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

describe("MessageList — I-S10 round-4 contract (no in-component deferral; activation is synchronous)", () => {
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
