/**
 * I43: Pending message visibility during session acquisition.
 *
 * Reproduces the UX gap: when a user sends a message while the session
 * is still being acquired, the message should appear immediately in the
 * chat window with a "Sending…" indicator — not vanish until the session
 * connects.
 *
 * The fix adds a `pending` flag to ChatMessage and renders pending
 * messages with reduced opacity + a "Sending…" label.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";

import { MessageList } from "../MessageList";
import type { ChatMessage } from "../../types/chat";
import type { IChatViewHost } from "../view-host";
import type AgentClientPlugin from "../../plugin";

// ============================================================================
// Mocks
// ============================================================================

beforeEach(() => {
	(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
	MarkdownRenderer: { render: vi.fn() },
	Component: class {},
}));

vi.mock("../MessageBubble", () => ({
	MessageBubble: ({ message }: { message: ChatMessage }) => (
		<div data-testid="bubble" data-message-id={message.id}>
			{message.content[0]?.type === "text"
				? (message.content[0] as { type: "text"; text: string }).text
				: ""}
		</div>
	),
}));

// ============================================================================
// Fixtures
// ============================================================================

const mockPlugin = {} as unknown as AgentClientPlugin;
const mockView = {
	registerDomEvent: vi.fn(),
} as unknown as IChatViewHost;

function makePendingMessage(text: string): ChatMessage {
	return {
		id: `pending-${Date.now()}`,
		role: "user",
		content: [{ type: "text", text }],
		timestamp: new Date(),
		pending: true,
	};
}

// ============================================================================
// Tests
// ============================================================================

describe("I43: Pending message visibility", () => {
	it("renders a pending message with the pending CSS class", () => {
		const pending = makePendingMessage("Hello agent");
		const { container } = render(
			<MessageList
				messages={[pending]}
				isSending={false}
				isSessionReady={false}
				isLazyIdle={false}
				isRestoringSession={false}
				agentLabel="Claude"
				plugin={mockPlugin}
				view={mockView}
				hasActivePermission={false}
			/>,
		);

		const row = container.querySelector(".agent-client-message-pending");
		expect(row).not.toBeNull();
	});

	it("shows a 'Sending…' label on pending messages", () => {
		const pending = makePendingMessage("Hello agent");
		const { container } = render(
			<MessageList
				messages={[pending]}
				isSending={false}
				isSessionReady={false}
				isLazyIdle={false}
				isRestoringSession={false}
				agentLabel="Claude"
				plugin={mockPlugin}
				view={mockView}
				hasActivePermission={false}
			/>,
		);

		const label = container.querySelector(".agent-client-pending-label");
		expect(label).not.toBeNull();
		expect(label?.textContent).toBe("Sending…");
	});

	it("does NOT show pending class or label on normal messages", () => {
		const normal: ChatMessage = {
			id: "msg-1",
			role: "user",
			content: [{ type: "text", text: "Normal message" }],
			timestamp: new Date(),
		};
		const { container } = render(
			<MessageList
				messages={[normal]}
				isSending={false}
				isSessionReady={true}
				isLazyIdle={false}
				isRestoringSession={false}
				agentLabel="Claude"
				plugin={mockPlugin}
				view={mockView}
				hasActivePermission={false}
			/>,
		);

		expect(container.querySelector(".agent-client-message-pending")).toBeNull();
		expect(container.querySelector(".agent-client-pending-label")).toBeNull();
	});

	it("pending message appears in the message list (not swallowed)", () => {
		const pending = makePendingMessage("Queued message");
		const { container } = render(
			<MessageList
				messages={[pending]}
				isSending={false}
				isSessionReady={false}
				isLazyIdle={false}
				isRestoringSession={false}
				agentLabel="Claude"
				plugin={mockPlugin}
				view={mockView}
				hasActivePermission={false}
			/>,
		);

		// The message text should be visible (not in empty state)
		const bubble = container.querySelector('[data-testid="bubble"]');
		expect(bubble).not.toBeNull();
		expect(bubble?.textContent).toBe("Queued message");
	});
});
