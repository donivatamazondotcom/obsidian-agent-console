import { describe, it, expect } from "vitest";

import {
	buildCarryOverTranscript,
	buildCarryOverBlocks,
	CARRY_OVER_BUDGET,
} from "../carry-over-builder";
import type { ChatMessage } from "../../types/chat";

function makeMessage(role: "user" | "assistant", text: string): ChatMessage {
	return {
		id: crypto.randomUUID(),
		role,
		content: [{ type: "text", text }],
		timestamp: new Date(),
	};
}

describe("buildCarryOverTranscript", () => {
	it("returns null for empty messages", () => {
		expect(buildCarryOverTranscript([])).toBeNull();
	});

	it("formats messages as 'Role: text' pairs", () => {
		const msgs = [
			makeMessage("user", "Hello"),
			makeMessage("assistant", "Hi there"),
		];
		const result = buildCarryOverTranscript(msgs);
		expect(result).toBe("User: Hello\n\nAssistant: Hi there");
	});

	it("respects the budget — drops oldest turns first", () => {
		const longMsg = "x".repeat(5000);
		const msgs = [
			makeMessage("user", longMsg), // ~5006 chars formatted
			makeMessage("assistant", longMsg), // ~5012 chars formatted
			makeMessage("user", "recent"), // ~12 chars formatted
		];
		// Budget 100 chars — only the last message should fit
		const result = buildCarryOverTranscript(msgs, 100);
		expect(result).toContain("[Earlier messages trimmed]");
		expect(result).toContain("User: recent");
		expect(result).not.toContain("x".repeat(100));
	});

	it("does not prepend trim notice when all messages fit", () => {
		const msgs = [
			makeMessage("user", "Hello"),
			makeMessage("assistant", "World"),
		];
		const result = buildCarryOverTranscript(msgs, 10_000);
		expect(result).not.toContain("[Earlier messages trimmed]");
	});

	it("uses CARRY_OVER_BUDGET (10k) by default", () => {
		expect(CARRY_OVER_BUDGET).toBe(10_000);
	});
});

describe("buildCarryOverBlocks", () => {
	const msgs = [
		makeMessage("user", "First question"),
		makeMessage("assistant", "First answer"),
	];

	it("returns empty array for no messages", () => {
		expect(buildCarryOverBlocks([], true)).toEqual([]);
	});

	it("returns resource block + text instruction when embeddedContext = true", () => {
		const blocks = buildCarryOverBlocks(msgs, true);
		expect(blocks).toHaveLength(2);
		expect(blocks[0].type).toBe("resource");
		expect(blocks[1].type).toBe("text");
		expect((blocks[1] as { text: string }).text).toContain(
			"earlier conversation the user carried over",
		);
	});

	it("returns XML text block when embeddedContext = false", () => {
		const blocks = buildCarryOverBlocks(msgs, false);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe("text");
		const text = (blocks[0] as { text: string }).text;
		expect(text).toContain("<carry_over_transcript>");
		expect(text).toContain("User: First question");
		expect(text).toContain("Assistant: First answer");
		expect(text).toContain("</carry_over_transcript>");
	});
});
