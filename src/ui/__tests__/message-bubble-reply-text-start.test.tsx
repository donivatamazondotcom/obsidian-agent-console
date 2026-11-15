/**
 * Jump to Start of Latest Reply — U14.
 *
 * MessageBubble marks the wrapper of an assistant message's non-empty text
 * group with `data-reply-text-start`; that's the element the jump lands on.
 * MessageList looks it up as `row > .agent-client-message-renderer >
 * [data-reply-text-start]`, so the attribute must sit on a direct child of
 * the renderer, never inside the rendered markdown.
 *
 * Real MessageBubble, real ToolCallBlock; only the Obsidian boundary is
 * mocked (markdown rendering resolves and writes the text).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		MarkdownRenderer: {
			render: vi.fn((_app: unknown, text: string, el: HTMLElement) => {
				el.textContent = text;
				return Promise.resolve();
			}),
		},
	};
});

import { MessageBubble } from "../MessageBubble";
import type { ChatMessage, MessageContent } from "../../types/chat";
import {
	makeIdleMcpAuthManager,
	makeMessageListPlugin,
} from "../../__test_stubs__/message-list-plugin";

afterEach(cleanup);

const plugin = makeMessageListPlugin({
	settings: { displaySettings: { showEmojis: false } },
	mcpAuthManager: makeIdleMcpAuthManager(),
	app: {
		workspace: { getActiveFile: () => null },
		vault: { adapter: {} },
	},
});

function bubble(role: "user" | "assistant", content: MessageContent[]) {
	const message: ChatMessage = { id: "m1", role, content, timestamp: new Date(0) };
	return render(<MessageBubble message={message} plugin={plugin} />);
}

const TOOL: MessageContent = {
	type: "tool_call",
	toolCallId: "tc-1",
	title: "shell",
	status: "completed",
};

describe("MessageBubble data-reply-text-start (U14)", () => {
	it("marks only the non-empty text group of an assistant message, as a direct child of the renderer", async () => {
		const { container } = bubble("assistant", [
			{ type: "agent_thought", text: "Thinking." },
			TOOL,
			{ type: "text", text: "The answer." },
		]);
		await act(async () => {
			await Promise.resolve(); // the markdown render resolves
		});
		const marked = container.querySelectorAll("[data-reply-text-start]");
		expect(marked).toHaveLength(1);
		const renderer = container.querySelector(".agent-client-message-renderer");
		expect(marked[0].parentElement).toBe(renderer);
		expect(marked[0].textContent).toContain("The answer.");
		// The group is the third rendered group (thought, tool, text).
		expect(Array.from(renderer?.children ?? []).indexOf(marked[0])).toBe(2);
	});

	it("does not mark a user message", () => {
		const { container } = bubble("user", [{ type: "text", text: "Question" }]);
		expect(container.querySelector("[data-reply-text-start]")).toBeNull();
	});

	it("does not mark whitespace-only assistant text", () => {
		const { container } = bubble("assistant", [TOOL, { type: "text", text: "  \n " }]);
		expect(container.querySelector("[data-reply-text-start]")).toBeNull();
	});

	it("does not mark a text-free assistant message", () => {
		const { container } = bubble("assistant", [TOOL]);
		expect(container.querySelector("[data-reply-text-start]")).toBeNull();
	});
});
