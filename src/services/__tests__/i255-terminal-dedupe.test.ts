/**
 * I255 — a shell tool call shows its terminal output twice until the tab
 * is reopened.
 *
 * Found in the Kiro CLI V3 S5 smoke (2026-11-01). Kiro V3 re-sends the same
 * `{ type: "terminal", terminalId }` content item on each tool_call_update
 * (once while running, again on completion). mergeToolCallContent appended
 * every update's content and only de-duplicated diffs, so the live tool call
 * held the same terminal twice and the UI rendered two output blocks.
 *
 * Contract: a terminal item is identified by its terminalId. Re-sending it
 * must not add a second block; distinct terminals are all kept, in order.
 * Enters at the runtime seam (applySingleUpdate over SessionUpdate events).
 */
import { describe, expect, it } from "vitest";

import { applySingleUpdate, createStreamContinuity } from "../message-state";
import type { ChatMessage, ToolCallContent } from "../../types/chat";
import type { SessionUpdate } from "../../types/session";

const SESSION = "sess-1";
const CALL = "call-1";

function terminal(id: string): ToolCallContent {
	return { type: "terminal", terminalId: id };
}

function diff(path: string, newText: string): ToolCallContent {
	return { type: "diff", path, newText, oldText: "" };
}

function toolCall(content?: ToolCallContent[]): SessionUpdate {
	return {
		type: "tool_call",
		sessionId: SESSION,
		toolCallId: CALL,
		title: "shell",
		kind: "execute",
		status: "pending",
		content,
	};
}

function update(
	status: "in_progress" | "completed",
	content?: ToolCallContent[],
): SessionUpdate {
	return {
		type: "tool_call_update",
		sessionId: SESSION,
		toolCallId: CALL,
		status,
		content,
	};
}

function applyAll(updates: SessionUpdate[]): ChatMessage[] {
	const index = new Map<string, number>();
	const continuity = createStreamContinuity();
	let messages: ChatMessage[] = [];
	for (const u of updates) {
		messages = applySingleUpdate(messages, u, index, continuity);
	}
	return messages;
}

function callContent(messages: ChatMessage[]): ToolCallContent[] {
	for (const m of messages) {
		for (const c of m.content) {
			if (c.type === "tool_call" && c.toolCallId === CALL) {
				return c.content ?? [];
			}
		}
	}
	throw new Error("tool call not found");
}

describe("I255: terminal content de-duplicated by terminalId", () => {
	// Kiro V3 wire shape: the terminal arrives on the running update and
	// again on the completion update.
	it("keeps one terminal block when two updates carry the same terminalId", () => {
		const messages = applyAll([
			toolCall(),
			update("in_progress", [terminal("term-1")]),
			update("completed", [terminal("term-1")]),
		]);
		expect(callContent(messages)).toEqual([terminal("term-1")]);
	});

	it("keeps one terminal block when the initial tool_call already carried it", () => {
		const messages = applyAll([
			toolCall([terminal("term-1")]),
			update("in_progress", [terminal("term-1")]),
			update("completed", [terminal("term-1")]),
		]);
		expect(callContent(messages)).toEqual([terminal("term-1")]);
	});

	it("keeps distinct terminals, in arrival order", () => {
		const messages = applyAll([
			toolCall(),
			update("in_progress", [terminal("term-1")]),
			update("in_progress", [terminal("term-2"), terminal("term-1")]),
			update("completed", [terminal("term-2")]),
		]);
		expect(callContent(messages)).toEqual([
			terminal("term-1"),
			terminal("term-2"),
		]);
	});

	it("leaves diff replacement unchanged alongside a repeated terminal", () => {
		const messages = applyAll([
			toolCall(),
			update("in_progress", [terminal("term-1"), diff("a.md", "v1")]),
			update("completed", [terminal("term-1"), diff("a.md", "v2")]),
		]);
		expect(callContent(messages)).toEqual([
			terminal("term-1"),
			diff("a.md", "v2"),
		]);
	});
});
