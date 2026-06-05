/**
 * I40 reproducing test: "Connecting..." text shown on idle (lazy) tabs.
 *
 * When a tab is in lazy-idle state (no ACP connection attempted), the UI
 * should NOT show "Connecting..." — it should indicate the tab is ready
 * for input and will connect on send.
 *
 * This test fails against the unfixed code because MessageList and
 * InputToolbar show "Connecting..." whenever `!isSessionReady`, without
 * distinguishing idle from actually-connecting.
 */

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";

import { MessageList } from "../MessageList";
import { InputToolbar } from "../InputToolbar";
import type { IChatViewHost } from "../view-host";
import type AgentClientPlugin from "../../plugin";

// ============================================================================
// Mocks
// ============================================================================

// ResizeObserver isn't relevant to these tests, but MessageList's
// use of useAutoScrollPin will instantiate one. Stub minimally.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
	MarkdownRenderer: { render: vi.fn() },
	Component: class {},
	Platform: { isMobile: false },
}));

vi.mock("../MessageBubble", () => ({
	MessageBubble: () => <div data-testid="bubble" />,
}));

// ============================================================================
// Fixtures
// ============================================================================

function makeView(): IChatViewHost {
	return {
		registerDomEvent: vi.fn(),
	} as unknown as IChatViewHost;
}

function makePlugin(): AgentClientPlugin {
	return {} as AgentClientPlugin;
}

// ============================================================================
// Tests
// ============================================================================

describe("I40: idle tab should not show 'Connecting...' text", () => {
	describe("MessageList empty state", () => {
		it("shows 'Send a message to connect' when idle (isLazyIdle=true)", () => {
			const { container } = render(
				<MessageList
					messages={[]}
					isSending={false}
					isSessionReady={false}
					isLazyIdle={true}
					isRestoringSession={false}
					agentLabel="Kiro CLI"
					plugin={makePlugin()}
					view={makeView()}
					hasActivePermission={false}
				/>,
			);

			const emptyState = container.querySelector(
				".agent-client-chat-empty-state",
			);
			expect(emptyState?.textContent).toContain(
				"Send a message to connect",
			);
			expect(emptyState?.textContent).not.toContain("Connecting");
		});

		it("shows 'Connecting...' when actually connecting (isLazyIdle=false)", () => {
			const { container } = render(
				<MessageList
					messages={[]}
					isSending={false}
					isSessionReady={false}
					isLazyIdle={false}
					isRestoringSession={false}
					agentLabel="Kiro CLI"
					plugin={makePlugin()}
					view={makeView()}
					hasActivePermission={false}
				/>,
			);

			const emptyState = container.querySelector(
				".agent-client-chat-empty-state",
			);
			expect(emptyState?.textContent).toContain("Connecting to Kiro CLI");
		});

		it("shows 'Start a conversation' when session is ready", () => {
			const { container } = render(
				<MessageList
					messages={[]}
					isSending={false}
					isSessionReady={true}
					isLazyIdle={false}
					isRestoringSession={false}
					agentLabel="Kiro CLI"
					plugin={makePlugin()}
					view={makeView()}
					hasActivePermission={false}
				/>,
			);

			const emptyState = container.querySelector(
				".agent-client-chat-empty-state",
			);
			expect(emptyState?.textContent).toContain("Start a conversation");
		});
	});

	describe("InputToolbar send button tooltip", () => {
		it("shows 'Send to connect' when idle (isLazyIdle=true)", () => {
			const { container } = render(
				<InputToolbar
					isSending={false}
					isButtonDisabled={false}
					hasContent={false}
					isSessionReady={false}
					isLazyIdle={true}
					onSendOrStop={vi.fn()}
					onModelChange={vi.fn()}
				/>,
			);

			const sendButton = container.querySelector(
				".agent-client-chat-send-button",
			);
			expect(sendButton?.getAttribute("aria-label")).toBe("Send to connect");
		});

		it("shows 'Connecting...' when actually connecting (isLazyIdle=false)", () => {
			const { container } = render(
				<InputToolbar
					isSending={false}
					isButtonDisabled={false}
					hasContent={false}
					isSessionReady={false}
					isLazyIdle={false}
					onSendOrStop={vi.fn()}
					onModelChange={vi.fn()}
				/>,
			);

			const sendButton = container.querySelector(
				".agent-client-chat-send-button",
			);
			expect(sendButton?.getAttribute("aria-label")).toBe("Connecting...");
		});
	});
});
