/**
 * I249: a tab whose connect failed still read "Connecting to {agent}..." in
 * its empty chat area, next to the error banner (found in the D3 smoke).
 *
 * MessageList fell through to the connecting text for every state that isn't
 * live, `error` included. The empty state now says the connect failed and
 * that sending retries; idle and connecting are unchanged (I40).
 *
 * Red-first: on the unfixed code the empty state reads "Connecting to Kiro CLI...".
 */

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";

import { MessageList } from "../MessageList";
import type { IChatViewHost } from "../view-host";
import type AgentClientPlugin from "../../plugin";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
	setTooltip: vi.fn(),
	MarkdownRenderer: { render: vi.fn() },
	Component: class {},
	Platform: { isMobile: false },
}));

vi.mock("../MessageBubble", () => ({
	MessageBubble: () => <div data-testid="bubble" />,
}));

function emptyStateFor(lazyState: "error" | "connecting" | "idle"): string {
	const { container } = render(
		<MessageList
			messages={[]}
			isSending={false}
			lazyState={lazyState}
			isRestoringSession={false}
			agentLabel="Kiro CLI"
			plugin={{} as AgentClientPlugin}
			view={{ registerDomEvent: vi.fn() } as unknown as IChatViewHost}
			hasActivePermission={false}
		/>,
	);
	return (
		container.querySelector(".agent-client-chat-empty-state")?.textContent ?? ""
	);
}

describe("I249: a failed connect doesn't read as connecting", () => {
	it("error state: says the connect failed and that sending retries", () => {
		const text = emptyStateFor("error");
		expect(text).not.toContain("Connecting");
		expect(text).toBe("Couldn't connect to Kiro CLI. Send a message to try again.");
	});

	it("connecting and idle are unchanged (I40)", () => {
		expect(emptyStateFor("connecting")).toContain("Connecting to Kiro CLI");
		expect(emptyStateFor("idle")).not.toContain("Connecting");
	});
});
