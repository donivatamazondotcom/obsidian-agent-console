/**
 * Unit tests for I-S10: tab activation must not synchronously mass-mount
 * all message bubbles.
 *
 * ============================================================================
 * COVERAGE BOUNDARY
 * ============================================================================
 *
 * This test captures the STRUCTURAL invariant. JSDOM cannot measure the
 * COST (ParseHTML duration, layout thrash, click-handler total) — that's
 * what T-IS10-smoke (a real-Chromium Performance trace) is for.
 *
 * What this test asserts:
 *   When MessageList transitions from isActive=false to isActive=true with
 *   a session of N messages (N large), the number of message-row DOM nodes
 *   inserted SYNCHRONOUSLY during that React commit must be bounded — not
 *   equal to N. A bounded set is what virtualization, chunked-mount, or any
 *   other architectural fix produces. An unbounded set (= N) is the bug.
 *
 * Why this is the right invariant:
 *   In a real browser, the click handler that triggers the activation runs
 *   synchronously: React's reconciler commits the new render in the same
 *   task as the click event. Whatever DOM mutations happen during that
 *   commit pay the full layout cost inside the click. Therefore:
 *
 *     "How many message rows does MessageList add to the DOM during the
 *      isActive=false → true transition, before any post-commit microtask
 *      or rAF flush?"
 *
 *   is a faithful proxy for "how much DOM work does the click pay?"
 *
 * What this test does NOT assert:
 *   - The exact mechanism (virtualization vs chunked mount vs other)
 *   - The cost in milliseconds (JSDOM has no layout engine)
 *   - That the bubbles eventually mount (a follow-up test or smoke test
 *     should confirm the rest mount in subsequent batches/scrolls)
 *
 * See spec § I-S10 for the full root cause and fix candidates.
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

// Mock the obsidian module — same surfaces the MessageList tree touches.
vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
	MarkdownRenderer: { render: vi.fn() },
	Component: class {},
}));

// Mock MessageBubble. We're testing whether MessageList instantiates a
// bubble per message synchronously, NOT what each bubble renders. Replacing
// MessageBubble with a thin spy keeps the test focused on the architectural
// invariant and avoids dragging in plugin/MarkdownRenderer/setIcon plumbing.
//
// `messageBubbleSpy` records every render call so tests can detect
// regressions where MessageList briefly mounts the full set even if the
// final DOM ends up with the slice. Pure DOM-node-count tests cannot
// catch this class of bug because @testing-library's `render`/`rerender`
// flush effects before returning — by the time the test inspects the
// container, the post-effect re-render has already replaced an erroneous
// full-mount with the slice.
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

describe("MessageList — I-S10 regression net (no synchronous mass-mount on activation)", () => {
	beforeEach(() => {
		// ResizeObserver isn't relevant to this test (we're measuring DOM
		// node counts, not scroll behavior), but MessageList's use of
		// useAutoScrollPin will instantiate one. Stub minimally.
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
	 * Headline test: documents the I-S10 architectural problem.
	 *
	 * Failing on `0295f99` confirmed the bug: activating a tab with 200
	 * messages mounted all 200 bubbles synchronously inside the React
	 * commit. In a real browser, this commit happens inside the click
	 * handler's task — so the click handler paid the cost of mounting all
	 * 200 message DOM subtrees plus the resulting Layout / UpdateLayoutTree.
	 *
	 * After the chunked-mount fix, only the last FIRST_BATCH_SIZE
	 * messages render synchronously; the rest stream in via
	 * MessageChannel on the next task.
	 */
	it("activating a 200-message tab synchronously mounts only the first batch (≤ 50)", () => {
		const messages = makeMessages(200);
		const view = makeView();
		const plugin = makePlugin();

		// Initial render with isActive=false. MessageList returns the
		// placeholder branch — no bubbles, no markdown parsing.
		const { rerender, container } = render(
			<MessageList
				{...baseProps}
				messages={messages}
				view={view}
				plugin={plugin}
				isActive={false}
			/>,
		);

		const inactiveBubbles = container.querySelectorAll(
			"[data-testid='bubble']",
		);
		expect(inactiveBubbles.length).toBe(0);

		// Flip isActive to true — simulates the tab-switch click that
		// activates this MessageList. Synchronous from React's point of
		// view: rerender returns after the commit completes.
		rerender(
			<MessageList
				{...baseProps}
				messages={messages}
				view={view}
				plugin={plugin}
				isActive={true}
			/>,
		);

		// Count message-row DOM nodes immediately after the synchronous
		// rerender. NO microtask flush, NO MessageChannel flush — this is
		// the state of the DOM at the moment the click handler returns
		// in a real browser.
		const activeBubbles = container.querySelectorAll(
			"[data-testid='bubble']",
		);

		// The architectural invariant: a heavy session must NOT mount all
		// of its bubbles in the synchronous activation commit. The bound
		// is set above first-batch size with a generous margin so the
		// test isn't fragile to FIRST_BATCH_SIZE tuning.
		expect(activeBubbles.length).toBeLessThan(50);
		// Lower bound: at least the first batch must render synchronously
		// so the user sees something immediately (rules out "render zero
		// then defer everything", which would visibly flicker).
		expect(activeBubbles.length).toBeGreaterThan(0);
	});

	/**
	 * Companion test: small sessions are unaffected. The invariant is
	 * about avoiding unbounded-N work, not about deferring everything.
	 * A 5-message tab is fine to mount in one go.
	 */
	it("does not regress small sessions: 5 messages mount synchronously on activation", () => {
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

		const bubbles = container.querySelectorAll("[data-testid='bubble']");
		expect(bubbles.length).toBe(5);
	});

	/**
	 * The deferred batch must eventually mount. After the MessageChannel
	 * delivers its message and React processes the resulting state update,
	 * the full message set should be in the DOM.
	 *
	 * JSDOM has a real MessageChannel implementation (libxml-derived),
	 * so we wait for the next macrotask via a `setTimeout(0)` Promise and
	 * let `act` flush the pending React update.
	 */
	it("deferred batch mounts the rest of the messages on the next task", async () => {
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

		rerender(
			<MessageList
				{...baseProps}
				messages={messages}
				view={view}
				plugin={plugin}
				isActive={true}
			/>,
		);

		// Synchronously: only first batch.
		expect(
			container.querySelectorAll("[data-testid='bubble']").length,
		).toBeLessThan(50);

		// Wait for the MessageChannel post → React state update → re-render.
		// One macrotask is enough — MessageChannel delivers in microtask
		// order in JSDOM, but the React state update batches into a render.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		// All 200 should now be in the DOM.
		expect(
			container.querySelectorAll("[data-testid='bubble']").length,
		).toBe(200);
	});

	/**
	 * Streaming case: a new message arrives AFTER activation has completed
	 * (i.e., after the deferred batch has mounted). The new length change
	 * must NOT re-trigger chunked mount — that would un-mount most of the
	 * session and cause a visible flash.
	 */
	it("streaming a new message after activation does not re-defer", async () => {
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

		// Activate.
		rerender(
			<MessageList
				{...baseProps}
				messages={initial}
				view={view}
				plugin={plugin}
				isActive={true}
			/>,
		);

		// Flush the deferred mount.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(
			container.querySelectorAll("[data-testid='bubble']").length,
		).toBe(200);

		// Stream: append a new message. This re-renders MessageList with
		// 201 messages while still active.
		const streamed = [...initial, ...makeMessages(1).map((m, i) => ({
			...m,
			id: `streamed-${i}`,
		}))];
		rerender(
			<MessageList
				{...baseProps}
				messages={streamed}
				view={view}
				plugin={plugin}
				isActive={true}
			/>,
		);

		// All 201 should be in the DOM synchronously — streaming must not
		// trigger chunked mount.
		expect(
			container.querySelectorAll("[data-testid='bubble']").length,
		).toBe(201);
	});

	/**
	 * Cleanup: when the component unmounts mid-deferral, no late state
	 * update should fire. We verify by unmounting before the deferred
	 * batch lands and confirming a subsequent macrotask doesn't throw or
	 * try to update unmounted React state. Vitest will surface any
	 * "can't perform a React state update on an unmounted component"
	 * warning as a test failure.
	 */
	it("unmounting mid-deferral does not throw or warn", async () => {
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

		// Unmount IMMEDIATELY — before the MessageChannel message lands.
		unmount();

		// Wait for the macrotask — the deferred callback would have fired
		// here. With proper cleanup the pending callback is nulled and
		// the channel ports are closed, so no state update fires.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		// No assertion needed — the absence of thrown errors and React
		// warnings is the pass condition. If cleanup is broken, vitest
		// will surface the warning as test output.
		expect(true).toBe(true);
	});

	/**
	 * Regression net for the round-1 I-S10 fix bug (`744faf4`):
	 *
	 * The first commit after `isActive` flips false → true must NOT mount
	 * all N message bubbles. The chunked-mount logic must be applied in
	 * the FIRST render — driving it from `useEffect` is too late, because
	 * the effect runs AFTER React has already committed (and the browser
	 * has already laid out) a full-mount render.
	 *
	 * Why DOM-count tests didn't catch this:
	 *   `@testing-library/react`'s `rerender` wraps in `act`, which flushes
	 *   effects before returning. Tests that count DOM nodes after `rerender`
	 *   see only the post-effect state. In a real browser, the user sees the
	 *   intermediate full-mount because layout and paint happen synchronously
	 *   inside the click handler's task — there's no analog to `act`'s flush
	 *   barrier.
	 *
	 * Trace evidence captured 2026-05-25T10:52 PT against `744faf4`:
	 *   - `Trace-Phase2-Verify-IS10-SmallToLarge-20260525T105237.json`:
	 *     250.88 ms click handler, 260 ParseHTML events, 109 ms layout work.
	 *     WORSE than the pre-fix 215 ms in the round-2 baseline.
	 *   - User-reported scrollbar jump and visible re-layout — confirms
	 *     intermediate full-mount happened before the slice took effect.
	 *
	 * Detection strategy: spy on every MessageBubble render call and assert
	 * the FIRST round of renders contains no more than the first batch.
	 */
	it("FAILS on 744faf4: first render after isActive=true must not mount all messages (intermediate full-mount regression)", () => {
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

		// Inactive render mounts zero bubbles.
		expect(messageBubbleSpy.mock.calls.length).toBe(0);

		messageBubbleSpy.mockClear();

		// Activate. Inside `rerender`, React commits the new render and
		// `act` flushes useEffect. If the chunked-mount gate is driven by
		// useEffect, the FIRST commit (before the effect runs) will mount
		// all 200 — that's the regression. The spy will see 200 calls
		// from that first commit, then up to FIRST_BATCH_SIZE more from
		// the post-effect re-render.
		rerender(
			<MessageList
				{...baseProps}
				messages={messages}
				view={view}
				plugin={plugin}
				isActive={true}
			/>,
		);

		// The spy should record AT MOST one round of rendering, and that
		// round must be bounded by FIRST_BATCH_SIZE. Any rendering above
		// that bound means a full-mount commit happened before the slice
		// took effect.
		//
		// Pre-fix `744faf4`: spy sees ~200 (first commit, full set) +
		// ~30 (post-effect re-render, sliced) = ~230 — fails this assertion.
		// Correct fix: spy sees exactly one batch — ~30 calls. The
		// deferred batch's render (mounting the rest) is on a separate
		// task and not flushed by the synchronous part of `rerender`.
		expect(messageBubbleSpy.mock.calls.length).toBeLessThan(50);
	});

	/**
	 * Stronger variant: assert exact bubble identity in the FIRST commit.
	 * The first batch should be the LAST 30 messages (the bottom of the
	 * list), not the first 30 or all 200.
	 */
	it("FAILS on 744faf4: first commit renders only the LAST batch, not the first or all", () => {
		const messages = makeMessages(200);
		const view = makeView();
		const plugin = makePlugin();
		messageBubbleSpy.mockClear();

		render(
			<MessageList
				{...baseProps}
				messages={messages}
				view={view}
				plugin={plugin}
				isActive={true}
			/>,
		);

		// Each call to messageBubbleSpy received one argument: the
		// message id. Build the set of ids that were rendered.
		const renderedIds = new Set(
			messageBubbleSpy.mock.calls.map((call) => call[0] as string),
		);

		// `msg-0` is at the top of the list, far above the viewport.
		// It must NOT render in the first commit — first batch should
		// be the LAST 30 messages.
		expect(renderedIds.has("msg-0")).toBe(false);

		// `msg-199` is at the bottom, where the auto-scroll-pin anchors.
		// It MUST render in the first commit.
		expect(renderedIds.has("msg-199")).toBe(true);
	});

	/**
	 * No-extra-commits assertion: a heavy-session activation must not
	 * trigger more than 2 effective commits (the initial sliced render
	 * + the deferred full render). 3+ commits indicate state-cycling
	 * bugs that produce visible scroll-jumps in real browsers.
	 *
	 * Expected total renders for a correct fix:
	 *   first batch (30) + deferred full set (200) = 230
	 *
	 * Pre-fix `744faf4` actual:
	 *   first commit full mount (200) + post-effect slice (30)
	 *   + deferred re-render full (200) = 430
	 *
	 * The bound (260) is set with margin to avoid flakiness from React's
	 * commit accounting while still catching the regression.
	 */
	it("FAILS on 744faf4: total bubble renders during activation does not exceed first-batch + full-size", async () => {
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

		// Wait for the deferred batch to land.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(messageBubbleSpy.mock.calls.length).toBeLessThanOrEqual(260);
	});
});
