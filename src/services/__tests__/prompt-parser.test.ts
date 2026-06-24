import { describe, it, expect } from "vitest";
import { parsePromptFile, splitFrontmatter } from "../prompt-parser";

/**
 * The parser takes `parseYaml` injected so it stays free of the obsidian
 * runtime. These tests inject a fake that returns the object the frontmatter
 * "means", letting us test the split + validation logic without a YAML engine.
 */
const yamlReturning =
	(obj: unknown) =>
	(_yaml: string): unknown =>
		obj;

const yamlThrowing = (): never => {
	throw new Error("bad yaml");
};

const AGENTS = ["kiro-cli", "claude-code-acp"];

// The fake parseYaml ignores the frontmatter text, so any non-empty fence
// works; only the body matters for these tests.
function file(body = "Do the thing."): string {
	return `---\nx: y\n---\n${body}`;
}

describe("splitFrontmatter", () => {
	it("splits a fenced frontmatter block from the body", () => {
		const { frontmatter, body } = splitFrontmatter(
			"---\nname: x\n---\nHello world",
		);
		expect(frontmatter).toBe("name: x");
		expect(body).toBe("Hello world");
	});

	it("returns null frontmatter when no fence is present", () => {
		const { frontmatter, body } = splitFrontmatter("Just a body");
		expect(frontmatter).toBeNull();
		expect(body).toBe("Just a body");
	});

	it("handles CRLF newlines", () => {
		const { frontmatter, body } = splitFrontmatter(
			"---\r\nname: x\r\n---\r\nBody",
		);
		expect(frontmatter).toBe("name: x");
		expect(body).toBe("Body");
	});

	it("tolerates leading blank lines before the fence", () => {
		const { frontmatter } = splitFrontmatter("\n\n---\nname: x\n---\nBody");
		expect(frontmatter).toBe("name: x");
	});
});

describe("parsePromptFile", () => {
	it("parses a complete valid prompt", () => {
		const result = parsePromptFile(
			"Prompts/daily.md",
			file(),
			yamlReturning({
				name: "daily briefing",
				description: "🗓️ Start daily brief.",
				agent: "kiro-cli",
				model: "claude-sonnet-4.6",
				mode: "my-personal-va",
				tags: ["dailyNote"],
			}),
			AGENTS,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.prompt).toEqual({
			path: "Prompts/daily.md",
			name: "daily briefing",
			description: "🗓️ Start daily brief.",
			prompt: "Do the thing.",
			agent: "kiro-cli",
			model: "claude-sonnet-4.6",
			mode: "my-personal-va",
			tags: ["dailyNote"],
		});
	});

	it("requires an agent", () => {
		const result = parsePromptFile(
			"p.md",
			file(),
			yamlReturning({ name: "x" }),
			AGENTS,
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors[0]).toContain("agent");
	});

	it("falls back name → filename basename and description → name", () => {
		const result = parsePromptFile(
			"Prompts/Weekly Sync.md",
			file(),
			yamlReturning({ agent: "kiro-cli" }),
			AGENTS,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.prompt.name).toBe("Weekly Sync");
		expect(result.prompt.description).toBe("Weekly Sync");
	});

	it("rejects an unknown agent when known agents are supplied", () => {
		const result = parsePromptFile(
			"p.md",
			file(),
			yamlReturning({ agent: "not-configured" }),
			AGENTS,
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors[0]).toContain("unknown agent");
	});

	it("skips the agent check when no known agents supplied", () => {
		const result = parsePromptFile(
			"p.md",
			file(),
			yamlReturning({ agent: "anything" }),
		);
		expect(result.ok).toBe(true);
	});

	it("treats an empty body as an error", () => {
		const result = parsePromptFile(
			"p.md",
			"---\nx: y\n---\n   ",
			yamlReturning({ agent: "kiro-cli" }),
			AGENTS,
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.some((e) => e.includes("body"))).toBe(true);
	});

	it("errors when frontmatter is missing entirely", () => {
		const result = parsePromptFile(
			"p.md",
			"No frontmatter here",
			yamlReturning({ agent: "kiro-cli" }),
			AGENTS,
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors[0]).toContain("frontmatter");
	});

	it("errors when frontmatter YAML fails to parse", () => {
		const result = parsePromptFile("p.md", file(), yamlThrowing, AGENTS);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors[0]).toContain("could not parse frontmatter");
	});

	it("defaults tags to [] (global prompt) when omitted", () => {
		const result = parsePromptFile(
			"p.md",
			file(),
			yamlReturning({ agent: "kiro-cli" }),
			AGENTS,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.prompt.tags).toEqual([]);
	});

	it("normalizes tags: strips leading #, dedupes, accepts a single string", () => {
		const result = parsePromptFile(
			"p.md",
			file(),
			yamlReturning({ agent: "kiro-cli", tags: "#a, b, a" }),
			AGENTS,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.prompt.tags).toEqual(["a", "b"]);
	});

	it("coerces a numeric model id to string (YAML 4.6 → '4.6')", () => {
		const result = parsePromptFile(
			"p.md",
			file(),
			yamlReturning({ agent: "kiro-cli", model: 4.6 }),
			AGENTS,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.prompt.model).toBe("4.6");
	});
});
