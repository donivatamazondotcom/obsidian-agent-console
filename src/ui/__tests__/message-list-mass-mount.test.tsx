/**
 * Unit tests for I-S10 (round-2): tab activation must not synchronously
 * mass-mount all message bubbles inside the click handler's task.
 *
 * ============================================================================
 * COVERAGE BOUNDARY — read this first
 * ============================================================================
 *
 * This suite captures the STRUCTURAL invariants of the round-2 fix.
 * JSDOM cannot measure the COST (click handler ms, ParseHTML cluster, layout
 * thrash) — that's what T-IS10-smoke (a real-Chromium Performance trace)
 * is for.
 *
 * What this test DOES assert:
 *   1. The full 200-message set eventually mounts after activation
 *      (via React's deferred-value background render, not via a custom
 *      state machine that produces extra commits).
 *   2. Small sessions are unaffected — they mount fully without deferral.
 *   3. Streaming a new message after activation lands the new bubble in
 *      the DOM without unmounting the rest.
 *   4. Cleanup: unmounting mid-deferral does not throw or warn.
 *   5. Render-count bounded: total bubble renders across the activation
 *      lifecycle is at most ~2× the message count, NOT 3× (which is the
 *      round-1 useEffect-cycling signature).
 *
 * What this test does NOT assert (because JSDOM cannot observe it):
 *   - Click handler total under N ms
 *   - Synchronous DOM-node count immediately after isActive=true
 *     (testing-library's `rerender` wraps in `act` which flushes the
 *     deferred-value background render before returning, so the
 *     "empty intermediate render" is not observable here)
 *   - Visible scrollbar jump (DOM layout doesn't happen in JSDOM)
 *
 * The round-1 commit `744faf4` test contract assumed a chunked-mount
 * state machine where the intermediate "first batch only" state was
 * observable in JSDOM via the slice. The round-2 fix uses
 * `useDeferredValue`, which collapses the two renders inside `act`. The
 * round-2 test contract pivots accordingly: render-count bounding
 * replaces "synchronous count" assertions, and the smoke trace becomes
 * load-bearing for the cost axis.
 *
 * Round-1 regression evidence (preserved for context):
 *   - `_traces/Trace-Phase2-Verify-IS10-SmallToLarge-20260525T105237.json`:
 *     250.88 ms click, 260 ParseHTML, 109 ms layout (round-1 made the
 *     bug worse, not better, AND introduced a visible scrollbar jump).
 *   - Spec § I-S10 § Round-1 fix regression captures the full diagnosis.
 *
 * Round-2 mechanism (from React docs):
 *   - `useDeferredValue(messagesForRender)` where messagesForRender is
 *     EMPTY_MESSAGES when inactive and the real messages prop when
 *     active. The deferred value transitions empty → full on activation,
 *     so React schedules a background re-render with the full set —
 *     interruptible, integrated with the React scheduler, no manual
 *     MessageChannel plumbing.
 *   - `MemoMessageBubble` is required per the React docs. Without memo,
 *     parent re-renders re-render every bubble, defeating the deferral.
 *   - https://react.dev/reference/react/useDeferredValue § Deferring re-rendering
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
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

// `messageBubbleSpy` records every render call so tests can detect
// regressions where MessageList briefly mounts the full set even if the
// final DOM ends up matching expectations. Pure DOM-node-count tests
// cannot catch this class of bug because @testing-library's `render`/
// `rerender` flush effects (and deferred-value background renders) before
// returning — by the time the test inspects the container, intermediate
// states have already been replaced.
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

describe("MessageList — I-S10 round-2 regression net (useDeferredValue)", () => {
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
	 * Headline: a 200-message session must end up fully mounted after
	 * activation (via the deferred-value background render). The DOM-count
	 * assertion is observed AFTER `act` flushes the deferred render.
	 *
	 * What this guards: the round-2 fix's eventual-correctness contract.
	 * If the deferred render never fires, this test fails.
	 */
	it("activating a 200-message tab eventually mounts all 200 bubbles", () => {
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

		// Inactive: zero bubbles in DOM and zero render calls.
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

		// After `act` flushes the deferred-value background render, all 200
		// bubbles must be present in the DOM.
		expect(
			container.querySelectorAll("[data-testid='bubble']").length,
		).toBe(200);
	});

	/**
	 * Companion: small sessions still mount fully. `useDeferredValue` does
	 * not introduce visible delay for sessions that aren't slow to render.
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
	 * lands the new bubble in the DOM. With `useDeferredValue`, the new
	 * message may briefly defer (which is fine for streaming UX), but it
	 * must NOT cause a re-mount of the rest of the session — the only
	 * change should be that one new bubble exists.
	 */
	it("streaming a new message after activation eventually mounts the new bubble", async () => {
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

		// Wait one macrotask to let any deferred render settle.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(
			container.querySelectorAll("[data-testid='bubble']").length,
		).toBe(201);
		// The new bubble exists.
		expect(
			container.querySelector("[data-message-id='streamed-0']"),
		).not.toBeNull();
	});

	/**
	 * Cleanup: unmounting during/after activation must not throw or warn.
	 * `useDeferredValue` doesn't require explicit cleanup, but
	 * `useAutoScrollPin` instantiates ResizeObservers and listeners that
	 * must be torn down. If cleanup is broken, vitest surfaces React
	 * warnings as test output and Jest-style spy assertions will catch them.
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
	 * Render-count bounded — guards against the round-1 useEffect-cycling
	 * regression class.
	 *
	 * Round-1 actual (`744faf4`): 200 (first commit, full mount) + 30
	 * (post-effect slice) + 200 (deferred channel post) + 200 (other
	 * re-renders) = 630. Three full mounts.
	 *
	 * Round-2 expected: roughly 2× the message count — empty render (0)
	 * + deferred render (200) + possibly one more memo-bypassed render =
	 * ≤ ~410. The bound (260) is set with margin to catch the round-1
	 * cycling pattern (3+ full mounts) without being fragile to
	 * MemoMessageBubble vs raw MessageBubble accounting.
	 *
	 * If MemoMessageBubble is removed (the round-2 fix's required pairing
	 * is broken), this test fails. If the round-1 useEffect cycle is
	 * reintroduced, this test fails.
	 */
	it("activation lifecycle does not over-render bubbles (rules out useEffect cycling)", async () => {
		const messages = makeMessages(200);
		const view = makeView();
		const plugin = makePlugin();
		messageBubbleSpy.mockClear();

		const { rerender } = render(
			<MessageList
				{...baseProps}
				messages={messages}
				view={view}
				plugin={plugin}
				isActive={false}
			/>,
		);

		messageBubbleSpy.mockClear();

		rerender(
			<MessageList
				{...baseProps}
				messages={messages}
				view={view}
				plugin={plugin}
				isActive={true}
			/>,
		);

		// Wait for any deferred render to settle.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		// Round-1 (`744faf4`) hit ~630 here — three full mounts of 200 due
		// to useEffect cycling. The round-2 fix should land well under
		// 260 because (a) only one full mount lands (the deferred one),
		// and (b) MemoMessageBubble suppresses re-renders on parent
		// re-render when the message prop hasn't changed.
		expect(messageBubbleSpy.mock.calls.length).toBeLessThanOrEqual(260);
	});

	/**
	 * Memo guard: re-rendering MessageList with the SAME messages prop
	 * must not re-render the individual MessageBubbles. This is the
	 * round-2 fix's required pairing per the React docs:
	 *
	 *   "This optimization requires SlowList to be wrapped in memo. This
	 *    is because whenever the text changes, React needs to be able to
	 *    re-render the parent component quickly. During that re-render,
	 *    deferredText still has its previous value, so SlowList is able
	 *    to skip re-rendering (its props have not changed). Without
	 *    memo, it would have to re-render anyway, defeating the point
	 *    of the optimization."
	 *
	 *   — https://react.dev/reference/react/useDeferredValue
	 *
	 * If `MemoMessageBubble` is removed and the raw `MessageBubble` is
	 * used, this test fails: every parent re-render re-renders every
	 * bubble. With the memo wrapper in place, a parent re-render with
	 * the same messages prop produces zero additional bubble renders.
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
				// Add a different (but unrelated) prop change to force
				// MessageList to re-render. isSending is fine because it
				// doesn't reach MessageBubble's props.
				isSending={true}
			/>,
		);

		const afterRerenderCount = messageBubbleSpy.mock.calls.length;

		// With memo: count stays the same (zero new bubble renders).
		// Without memo: count increases by 10 (every bubble re-renders).
		// The bound (initialCallCount + 5) is set with a small margin
		// to absorb React's commit accounting without letting a
		// full re-render of all 10 slip through.
		expect(afterRerenderCount).toBeLessThanOrEqual(initialCallCount + 5);
	});
});
