/**
 * I185 — text chunks glued across tool-call boundaries destroy
 * line-anchored markdown (a2ui fences, headings, lists).
 *
 * Found live (2026-07-31, "Prep for ongoing TCOM meeting" session): the
 * agent streamed prose ending "…before I post?" (no trailing newline), made
 * tool calls, then streamed a NEW message block starting with ```a2ui at
 * column 0. applyUpdateLastMessage merged both text chunks with plain string
 * concatenation into one text item, producing "…before I post?```a2ui\n…" —
 * the fence opener lands mid-line, so neither the a2ui fence extractor
 * (line-anchored FENCE_OPEN) nor CommonMark recognizes it. The surface
 * rendered as raw prose with an auto-linked URL.
 *
 * Contract: raw concatenation is only correct for contiguous stream
 * fragments (mid-sentence). Once a tool call interleaves after the text
 * item, the next text chunk is a new block — the merge must guarantee a
 * paragraph boundary ("\n\n") between the existing text and the new chunk.
 */
import { describe, expect, it } from "vitest";

import {
	applySingleUpdate,
	createStreamContinuity,
} from "../message-state";
import { segmentAssistantMessage } from "../a2ui/segmenter";
import type { ChatMessage } from "../../types/chat";
import type { SessionUpdate } from "../../types/session";

const SESSION = "sess-1";

function textChunk(text: string): SessionUpdate {
	return { type: "agent_message_chunk", sessionId: SESSION, text };
}

function toolCall(id: string): SessionUpdate {
	return {
		type: "tool_call",
		sessionId: SESSION,
		toolCallId: id,
		title: "shell",
		status: "completed",
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

function lastText(messages: ChatMessage[], type: "text" | "agent_thought") {
	const last = messages[messages.length - 1];
	const item = last.content.find((c) => c.type === type);
	if (!item || !("text" in item)) throw new Error(`no ${type} item`);
	return item.text;
}

function mergedText(messages: ChatMessage[]): string {
	return lastText(messages, "text");
}

function toolCallUpdate(id: string): SessionUpdate {
	return {
		type: "tool_call_update",
		sessionId: SESSION,
		toolCallId: id,
		status: "completed",
	};
}

const FENCE_BLOCK =
	'```a2ui\n{"version":"v1.0","createSurface":{"surfaceId":"s-1"}}\n```';

describe("I185: block boundary across interleaved tool calls", () => {
	it("keeps raw concatenation for contiguous stream fragments", () => {
		const messages = applyAll([
			textChunk("Hello, wor"),
			textChunk("ld — same sentence."),
		]);
		expect(mergedText(messages)).toBe("Hello, world — same sentence.");
	});

	// Live shape ("Prep for ongoing TCOM meeting", messages[40]): the
	// message is [tool_call, text]; a tool_call_update mutates the call in
	// place, so the next text chunk merges into the SAME text item.
	it("inserts a paragraph boundary when a tool_call_update interleaved (live repro)", () => {
		const messages = applyAll([
			toolCall("tc-1"),
			textChunk("Want me to send this as-is, or adjust before I post?"),
			toolCallUpdate("tc-1"),
			textChunk(FENCE_BLOCK),
		]);
		const text = mergedText(messages);
		// The fence opener must start at a line beginning.
		expect(text).toContain("before I post?\n\n```a2ui");
	});

	it("a2ui fence survives the merge and segments as a surface (outcome)", () => {
		const messages = applyAll([
			toolCall("tc-1"),
			textChunk("Want me to send this as-is, or adjust before I post?"),
			toolCallUpdate("tc-1"),
			textChunk(FENCE_BLOCK),
		]);
		const segments = segmentAssistantMessage(mergedText(messages));
		expect(segments.some((s) => s.kind === "a2ui-surface")).toBe(true);
	});

	it("does not over-separate when a boundary already exists", () => {
		const messages = applyAll([
			toolCall("tc-1"),
			textChunk("First block.\n\n"),
			toolCallUpdate("tc-1"),
			textChunk("Second block."),
		]);
		expect(mergedText(messages)).toBe("First block.\n\nSecond block.");
	});

	it("completes a partial boundary (existing trailing newline)", () => {
		const messages = applyAll([
			toolCall("tc-1"),
			textChunk("First block.\n"),
			toolCallUpdate("tc-1"),
			textChunk("Second block."),
		]);
		expect(mergedText(messages)).toBe("First block.\n\nSecond block.");
	});

	it("applies the same boundary rule to thought chunks", () => {
		const messages = applyAll([
			toolCall("tc-1"),
			{
				type: "agent_thought_chunk",
				sessionId: SESSION,
				text: "Thinking.",
			},
			toolCallUpdate("tc-1"),
			{
				type: "agent_thought_chunk",
				sessionId: SESSION,
				text: "More.",
			},
		]);
		expect(lastText(messages, "agent_thought")).toBe("Thinking.\n\nMore.");
	});

	it("text resuming after an interleaved thought block gets a boundary", () => {
		const messages = applyAll([
			toolCall("tc-1"),
			textChunk("Before thought."),
			{
				type: "agent_thought_chunk",
				sessionId: SESSION,
				text: "Reasoning…",
			},
			textChunk("## After thought"),
		]);
		expect(mergedText(messages)).toBe(
			"Before thought.\n\n## After thought",
		);
	});
});
