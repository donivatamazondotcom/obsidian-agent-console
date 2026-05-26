/**
 * Unit tests for replayContextBuilder (Slice 1 of Tab Persistence + Lazy Sessions).
 *
 * Pins Decision #7 of [[ACP Tab Persistence Across Restarts]]:
 *   On `session/load` failure, fall through to client-side replay via
 *   `session/new` + synthetic context block (Approach A.2 with cap).
 *   Format prior turns as `**User:** … **Assistant:** …` in a single
 *   context block prepended to the new session. Tool calls are included
 *   with each tool's output capped at 2KB (truncated with
 *   `[output truncated]` marker); calls beyond the cap preserve the call
 *   reference and arguments but truncate output.
 *
 * Coverage map (per spec § Unit Tests → U49–U60):
 *
 *   truncateToolOutput
 *     U54  ≤ 2KB renders unchanged
 *     U55  > 2KB truncated to 2KB ending with [output truncated] marker
 *
 *   buildReplayContextBlock
 *     U49  Empty history returns empty string
 *     U50  Single user message renders as **User:** {text}
 *     U51  Single assistant message renders as **Assistant:** {text}
 *     U52  Mixed user/assistant turns alternate in order
 *     U53  Tool call within an assistant turn renders as
 *          **Assistant called {tool}:** {args} → {output}
 *     U56  Tool call reference and arguments are NEVER truncated, even
 *          when output is
 *     U57  Multiple tool calls in one turn render in order, each capped
 *          independently
 *     U58  Context block is wrapped with a "Prior conversation" header
 *     U59  Context block does NOT use **System:** role
 *     U60  Returns a string (single prompt content block), not an array
 *
 * The byte cap is 2048 (2 * 1024) per Decision #7. Marker string is exactly
 * `[output truncated]` (18 ASCII bytes). Truncation must be UTF-8 safe — do
 * not slice mid-codepoint; truncated bytes + marker must total ≤ 2048.
 */

import { describe, it, expect } from "vitest";
import type { ChatMessage, ToolKind } from "../../types/chat";
import {
	buildReplayContextBlock,
	truncateToolOutput,
} from "../replayContextBuilder";

// ============================================================================
// Fixtures
// ============================================================================

function userMessage(id: string, text: string): ChatMessage {
	return {
		id,
		role: "user",
		content: [{ type: "text", text }],
		timestamp: new Date("2026-05-26T10:00:00Z"),
	};
}

function assistantMessage(id: string, text: string): ChatMessage {
	return {
		id,
		role: "assistant",
		content: [{ type: "text", text }],
		timestamp: new Date("2026-05-26T10:00:00Z"),
	};
}

function assistantWithToolCall(
	id: string,
	args: {
		text?: string;
		toolTitle?: string;
		toolKind?: ToolKind;
		rawInput?: { [k: string]: unknown };
		rawOutput?: { [k: string]: unknown };
	},
): ChatMessage {
	const content: ChatMessage["content"] = [];
	if (args.text !== undefined) {
		content.push({ type: "text", text: args.text });
	}
	content.push({
		type: "tool_call",
		toolCallId: `tc-${id}`,
		title: args.toolTitle ?? null,
		status: "completed",
		kind: args.toolKind,
		rawInput: args.rawInput,
		rawOutput: args.rawOutput,
	});
	return {
		id,
		role: "assistant",
		content,
		timestamp: new Date("2026-05-26T10:00:00Z"),
	};
}

// ============================================================================
// truncateToolOutput
// ============================================================================

describe("truncateToolOutput", () => {
	const CAP = 2048;
	const MARKER = "[output truncated]";

	it("U54: returns output unchanged when ≤ 2KB", () => {
		const small = "hello world";
		const result = truncateToolOutput(small);
		expect(result.text).toBe(small);
		expect(result.truncated).toBe(false);
	});

	it("U54: returns output unchanged when exactly 2KB", () => {
		const exact = "x".repeat(CAP);
		const result = truncateToolOutput(exact);
		expect(result.text).toBe(exact);
		expect(result.truncated).toBe(false);
	});

	it("U55: truncates output > 2KB and ends with the truncation marker", () => {
		const oversize = "x".repeat(CAP + 500);
		const result = truncateToolOutput(oversize);
		expect(result.truncated).toBe(true);
		expect(result.text.endsWith(MARKER)).toBe(true);
	});

	it("U55: truncated total length is ≤ 2KB in bytes", () => {
		const oversize = "x".repeat(CAP * 4);
		const result = truncateToolOutput(oversize);
		expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(CAP);
	});

	it("U55: truncation does not slice in the middle of a multi-byte UTF-8 codepoint", () => {
		// "💡" is U+1F4A1 → 4 bytes in UTF-8. Build a string whose byte length
		// crosses the cap right inside one of these codepoints.
		const filler = "a".repeat(CAP - 2); // 2 bytes shy of the cap
		const oversize = filler + "💡".repeat(20); // pushes past the cap mid-codepoint
		const result = truncateToolOutput(oversize);
		// The returned text must still decode as valid UTF-8 — Buffer.from
		// + toString round-trips losslessly when the bytes are valid.
		const roundTrip = Buffer.from(result.text, "utf8").toString("utf8");
		expect(roundTrip).toBe(result.text);
		expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(CAP);
		expect(result.text.endsWith(MARKER)).toBe(true);
	});

	it("respects a custom capBytes argument", () => {
		const text = "x".repeat(200);
		const result = truncateToolOutput(text, 100);
		expect(result.truncated).toBe(true);
		expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(100);
		expect(result.text.endsWith(MARKER)).toBe(true);
	});
});

// ============================================================================
// buildReplayContextBlock
// ============================================================================

describe("buildReplayContextBlock", () => {
	it("U49: returns empty string for empty history", () => {
		expect(buildReplayContextBlock([])).toBe("");
	});

	it("U50: renders a single user message as **User:** {text}", () => {
		const block = buildReplayContextBlock([userMessage("m1", "Hello world")]);
		expect(block).toContain("**User:** Hello world");
	});

	it("U51: renders a single assistant message as **Assistant:** {text}", () => {
		const block = buildReplayContextBlock([
			assistantMessage("m1", "Hi there!"),
		]);
		expect(block).toContain("**Assistant:** Hi there!");
	});

	it("U52: renders mixed user/assistant turns alternating in order", () => {
		const block = buildReplayContextBlock([
			userMessage("m1", "first user"),
			assistantMessage("m2", "first assistant"),
			userMessage("m3", "second user"),
			assistantMessage("m4", "second assistant"),
		]);
		const idxU1 = block.indexOf("first user");
		const idxA1 = block.indexOf("first assistant");
		const idxU2 = block.indexOf("second user");
		const idxA2 = block.indexOf("second assistant");
		// All present
		expect(idxU1).toBeGreaterThan(-1);
		expect(idxA1).toBeGreaterThan(-1);
		expect(idxU2).toBeGreaterThan(-1);
		expect(idxA2).toBeGreaterThan(-1);
		// Order preserved
		expect(idxU1).toBeLessThan(idxA1);
		expect(idxA1).toBeLessThan(idxU2);
		expect(idxU2).toBeLessThan(idxA2);
	});

	it("U53: renders a tool call within an assistant turn as **Assistant called {tool}:** {args} → {output}", () => {
		const block = buildReplayContextBlock([
			assistantWithToolCall("m1", {
				toolTitle: "read",
				rawInput: { path: "foo.ts" },
				rawOutput: { content: "export const x = 1;" },
			}),
		]);
		expect(block).toContain("**Assistant called read:**");
		expect(block).toContain('{"path":"foo.ts"}');
		expect(block).toContain("→");
		expect(block).toContain('{"content":"export const x = 1;"}');
	});

	it("U53: assistant text and tool call are both rendered when both are present", () => {
		const block = buildReplayContextBlock([
			assistantWithToolCall("m1", {
				text: "Let me check.",
				toolTitle: "read",
				rawInput: { path: "foo.ts" },
				rawOutput: { content: "ok" },
			}),
		]);
		expect(block).toContain("**Assistant:** Let me check.");
		expect(block).toContain("**Assistant called read:**");
		// Text comes before the tool call (content-block order is preserved)
		expect(block.indexOf("**Assistant:** Let me check.")).toBeLessThan(
			block.indexOf("**Assistant called read:**"),
		);
	});

	it("U56: tool call args (rawInput) are NEVER truncated, even when output is", () => {
		// Build args that on their own exceed the 2KB cap.
		const fatPath = "x".repeat(3000);
		const fatOutput = { blob: "y".repeat(3000) };
		const block = buildReplayContextBlock([
			assistantWithToolCall("m1", {
				toolTitle: "read",
				rawInput: { path: fatPath },
				rawOutput: fatOutput,
			}),
		]);
		// Args are preserved in full
		expect(block).toContain(JSON.stringify({ path: fatPath }));
		// Output is truncated and ends with the marker
		expect(block).toContain("[output truncated]");
		// The full fat output should NOT appear in the block
		expect(block).not.toContain("y".repeat(3000));
	});

	it("U57: multiple tool calls in one assistant turn render in order, each capped independently", () => {
		const fat1 = "1".repeat(3000);
		const fat2 = "2".repeat(3000);
		const message: ChatMessage = {
			id: "m1",
			role: "assistant",
			content: [
				{
					type: "tool_call",
					toolCallId: "tc-a",
					title: "read",
					status: "completed",
					rawInput: { path: "a.ts" },
					rawOutput: { content: fat1 },
				},
				{
					type: "tool_call",
					toolCallId: "tc-b",
					title: "edit",
					status: "completed",
					rawInput: { path: "b.ts" },
					rawOutput: { content: fat2 },
				},
			],
			timestamp: new Date("2026-05-26T10:00:00Z"),
		};
		const block = buildReplayContextBlock([message]);
		const idxA = block.indexOf("**Assistant called read:**");
		const idxB = block.indexOf("**Assistant called edit:**");
		expect(idxA).toBeGreaterThan(-1);
		expect(idxB).toBeGreaterThan(-1);
		expect(idxA).toBeLessThan(idxB);
		// Both outputs are independently truncated
		const truncatedMarkers = block.match(/\[output truncated\]/g) ?? [];
		expect(truncatedMarkers.length).toBe(2);
		// Neither full payload survives in the block
		expect(block).not.toContain("1".repeat(3000));
		expect(block).not.toContain("2".repeat(3000));
	});

	it("U58: prepends a 'Prior conversation' header", () => {
		const block = buildReplayContextBlock([
			userMessage("m1", "hello"),
		]);
		// Header appears at the start of the block
		expect(block.startsWith("Prior conversation")).toBe(true);
	});

	it("U59: never uses **System:** role anywhere in the output", () => {
		const block = buildReplayContextBlock([
			userMessage("m1", "hello"),
			assistantMessage("m2", "hi"),
			assistantWithToolCall("m3", {
				toolTitle: "read",
				rawInput: { path: "f.ts" },
				rawOutput: { content: "ok" },
			}),
		]);
		expect(block).not.toContain("**System:**");
		expect(block.toLowerCase()).not.toContain("system:");
	});

	it("U60: returns a string (single prompt content block), not an array", () => {
		const block = buildReplayContextBlock([userMessage("m1", "hi")]);
		expect(typeof block).toBe("string");
		expect(Array.isArray(block)).toBe(false);
	});

	it("U60: returns a string for empty input as well", () => {
		expect(typeof buildReplayContextBlock([])).toBe("string");
	});
});
