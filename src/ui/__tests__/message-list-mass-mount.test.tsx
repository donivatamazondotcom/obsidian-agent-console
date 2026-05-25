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
import { render } from "@testing-library/react";
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
vi.mock("../MessageBubble", () => ({
	MessageBubble: ({ message }: { message: ChatMessage }) => (
		<div data-testid="bubble" data-message-id={message.id}>
			{/* Stub body — real MessageBubble parses markdown via Obsidian's
			    MarkdownRenderer, which is the dominant cost. The architectural
			    question this test asks is "how many bubbles get instantiated",
			    not "how expensive is each bubble". */}
		</div>
	),
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
	 * Failing on `0295f99` confirms the bug: activating a tab with 200
	 * messages mounts all 200 bubbles synchronously inside the React
	 * commit. In a real browser, this commit happens inside the click
	 * handler's task — so the click handler pays the cost of mounting all
	 * 200 message DOM subtrees plus the resulting Layout / UpdateLayoutTree.
	 *
	 * A passing version of this test means: some mechanism (virtualization,
	 * chunked mount, deferred ChatPanel mount, or other) bounds the number
	 * of bubbles instantiated during the synchronous activation commit to
	 * less than the full session size.
	 */
	it("FAILS on 0295f99: activating a 200-message tab synchronously mounts all 200 bubbles", () => {
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
		// rerender. NO microtask flush, NO rAF, NO scroll event — this is
		// the state of the DOM at the moment the click handler returns
		// in a real browser.
		const activeBubbles = container.querySelectorAll(
			"[data-testid='bubble']",
		);

		// The architectural invariant: a heavy session must NOT mount all
		// of its bubbles in the synchronous activation commit. Pick a
		// reasonable upper bound — even a single viewport's worth of
		// virtualization (~10-20 bubbles) plus generous overscan should
		// be under 50.
		expect(activeBubbles.length).toBeLessThan(50);
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
});
