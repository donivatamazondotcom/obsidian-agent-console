import { describe, it, expect } from "vitest";
import { parseAgentArgs, formatAgentArgs } from "../args";

/**
 * I162 — the Arguments field footgun. The old parser split on newlines ONLY,
 * so a single-line `acp --agent auto-sa` became ONE token
 * (`["acp --agent auto-sa"]`) and the agent failed to start
 * ("ACP connection closed"). These tests pin the forgiving behavior.
 */
describe("parseAgentArgs — I162 forgiving parser", () => {
	it("splits a single space-separated line into separate args (the bug)", () => {
		// Old newline-only parser returned ["acp --agent auto-sa"] here.
		expect(parseAgentArgs("acp --agent auto-sa")).toEqual([
			"acp",
			"--agent",
			"auto-sa",
		]);
	});

	it("still parses one-argument-per-line identically", () => {
		expect(parseAgentArgs("acp\n--agent\nauto-sa")).toEqual([
			"acp",
			"--agent",
			"auto-sa",
		]);
	});

	it("mixes lines and spaces, collapsing blank lines and extra whitespace", () => {
		expect(parseAgentArgs("acp   --agent auto-sa\n\n  --verbose ")).toEqual([
			"acp",
			"--agent",
			"auto-sa",
			"--verbose",
		]);
	});

	it("preserves spaces inside double-quoted arguments", () => {
		expect(parseAgentArgs('--msg "hello world"')).toEqual([
			"--msg",
			"hello world",
		]);
	});

	it("preserves spaces inside single-quoted arguments", () => {
		expect(parseAgentArgs("--msg 'hello world'")).toEqual([
			"--msg",
			"hello world",
		]);
	});

	it("honors backslash-escaped spaces outside quotes", () => {
		expect(parseAgentArgs("hello\\ world")).toEqual(["hello world"]);
	});

	it("honors escaped quotes inside double quotes", () => {
		expect(parseAgentArgs('--say "he said \\"hi\\""')).toEqual([
			"--say",
			'he said "hi"',
		]);
	});

	it("returns [] for empty or whitespace-only input", () => {
		expect(parseAgentArgs("")).toEqual([]);
		expect(parseAgentArgs("   \n\t ")).toEqual([]);
	});

	it("treats an unclosed quote as one token (graceful, no throw)", () => {
		expect(parseAgentArgs('--msg "unterminated')).toEqual([
			"--msg",
			"unterminated",
		]);
	});
});

describe("formatAgentArgs — round-trip stable", () => {
	it("renders simple args one per line", () => {
		expect(formatAgentArgs(["acp", "--agent", "auto-sa"])).toBe(
			"acp\n--agent\nauto-sa",
		);
	});

	it("quotes args containing spaces so they round-trip", () => {
		expect(formatAgentArgs(["--msg", "hello world"])).toBe(
			'--msg\n"hello world"',
		);
	});

	it("renders an empty-string arg as \"\"", () => {
		expect(formatAgentArgs([""])).toBe('""');
	});

	// The invariant that matters: format then parse yields the original array.
	it.each([
		[["acp", "--agent", "auto-sa"]],
		[["--msg", "hello world"]],
		[["--path", "/a b/c"]],
		[["--say", 'he said "hi"']],
		[["--regex", "a\\b"]],
		[["", "x"]],
	])("round-trips %j through format→parse", (args) => {
		expect(parseAgentArgs(formatAgentArgs(args))).toEqual(args);
	});
});
