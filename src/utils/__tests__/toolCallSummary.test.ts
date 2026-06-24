import { describe, it, expect } from "vitest";
import {
	countLines,
	countJsonLines,
	formatRawPayload,
	hasRenderableContent,
} from "../toolCallSummary";
import { computeDiffLines } from "../toolCallDiff";
import type { MessageContent } from "../../types/chat";

type ToolCall = Extract<MessageContent, { type: "tool_call" }>;

/** Build a minimal tool_call content object for testing. */
function tc(partial: Partial<ToolCall>): ToolCall {
	return {
		type: "tool_call",
		toolCallId: "t1",
		status: "completed",
		...partial,
	} as ToolCall;
}

describe("toolCallSummary.formatRawPayload", () => {
	it("returns empty string for absent or empty payloads", () => {
		expect(formatRawPayload(undefined)).toBe("");
		expect(formatRawPayload({})).toBe("");
	});

	it("pretty-prints a payload object as JSON", () => {
		const out = formatRawPayload({ a: 1, b: "x" });
		expect(out).toBe('{\n  "a": 1,\n  "b": "x"\n}');
	});
});

describe("toolCallSummary.countJsonLines", () => {
	// The badge uses this cheap structural counter instead of serializing the
	// payload on every render; it MUST equal what JSON.stringify(_, null, 2)
	// renders, or the collapsed badge would drift from the expanded body.
	const cases: { label: string; value: unknown }[] = [
		{ label: "string", value: "hi" },
		{ label: "number", value: 42 },
		{ label: "boolean", value: true },
		{ label: "null", value: null },
		{ label: "empty object", value: {} },
		{ label: "empty array", value: [] },
		{ label: "flat object", value: { a: 1, b: "x" } },
		{ label: "flat array", value: [1, 2, 3] },
		{
			label: "spawn-like payload",
			value: {
				task: "audit",
				stages: [{ name: "audit", prompt: "look\nthen do" }],
			},
		},
		{
			label: "nested with empty list",
			value: { nested: { deep: { x: [1, { y: 2 }] } }, list: [] },
		},
	];

	it("equals JSON.stringify(_, null, 2) line count without serializing", () => {
		for (const { label, value } of cases) {
			expect(countJsonLines(value), label).toBe(
				JSON.stringify(value, null, 2).split("\n").length,
			);
		}
	});

	it("counts a multi-line string value as one line (JSON escapes \\n)", () => {
		// { , "prompt": "a\nb\nc" , } → 3 lines
		expect(countJsonLines({ prompt: "a\nb\nc" })).toBe(3);
	});
});

describe("toolCallSummary.hasRenderableContent", () => {
	it("is true when a diff or terminal block is present", () => {
		expect(
			hasRenderableContent(
				tc({ content: [{ type: "terminal", terminalId: "x" }] }),
			),
		).toBe(true);
	});

	it("is false for a generic tool call with only rawInput/rawOutput", () => {
		expect(
			hasRenderableContent(
				tc({ rawInput: { stages: ["a"] }, rawOutput: { ok: true } }),
			),
		).toBe(false);
	});
});

describe("toolCallSummary.countLines", () => {
	// I03 phantom body: the badge counted JSON-flattened rawInput/rawOutput,
	// but the expanded body rendered nothing for a generic (spawn/MCP) call.
	// Now the body renders the formatted payload, so the count must equal the
	// number of lines that payload actually renders to.
	it("counts the rendered payload for a generic tool call (e.g. spawn)", () => {
		const rawInput = {
			task: "audit, create ESLint rule, run against codebase",
			stages: [{ name: "audit", prompt: "look at the repo" }],
		};
		const rawOutput = { status: "spawned", crewId: "crew-7" };
		const call = tc({ title: "Spawning agent crew", rawInput, rawOutput });

		const expected =
			formatRawPayload(rawInput).split("\n").length +
			formatRawPayload(rawOutput).split("\n").length;

		expect(countLines(call)).toBe(expected);
		// Badge is non-zero AND every counted line is actually rendered.
		expect(countLines(call)).toBeGreaterThan(0);
	});

	// I79: a single-line edit used to read "8 lines" while the body renders 2.
	// The count must now equal the exact rendered diff and ignore rawInput/rawOutput.
	it("counts the exact rendered diff for an edit, ignoring rawInput/rawOutput", () => {
		const diff = {
			type: "diff" as const,
			path: "foo.ts",
			oldText: "const a = 1;",
			newText: "const a = 2;",
		};
		const call = tc({
			kind: "edit",
			content: [diff],
			rawInput: { path: "foo.ts", oldStr: "const a = 1;", newStr: "const a = 2;" },
			rawOutput: { message: "Successfully replaced 1 occurrence" },
		});

		const rendered = computeDiffLines(diff).length;
		expect(countLines(call)).toBe(rendered);
		expect(rendered).toBe(2); // 1 removed + 1 added
	});

	it("counts all added lines for a new-file diff", () => {
		const diff = {
			type: "diff" as const,
			path: "new.ts",
			oldText: null,
			newText: "line1\nline2\nline3",
		};
		const call = tc({ kind: "edit", content: [diff] });
		expect(countLines(call)).toBe(3);
	});

	it("counts the command strip plus the terminal placeholder for execute calls", () => {
		const call = tc({
			kind: "execute",
			rawInput: { command: "ls", args: ["-la"] },
			content: [{ type: "terminal", terminalId: "term-1" }],
			rawOutput: { stdout: "a\nb\nc" },
		});
		// 1 (command strip) + 1 (terminal placeholder); rawOutput is not counted
		// because the live terminal stream is rendered separately.
		expect(countLines(call)).toBe(2);
	});

	it("returns 0 when there is nothing to render", () => {
		expect(countLines(tc({}))).toBe(0);
	});
});
