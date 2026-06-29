import { describe, it, expect } from "vitest";
import {
	formatSessionTitle,
	DEFAULT_SESSION_TITLE,
} from "../format-session-title";

describe("formatSessionTitle", () => {
	it("passes a clean AI-style title through unchanged", () => {
		expect(formatSessionTitle("Resume Obsidian system prompt work")).toBe(
			"Resume Obsidian system prompt work",
		);
	});

	it("renders a markdown link to its label (the screenshot case)", () => {
		expect(
			formatSessionTitle(
				"[@Shared Links Bubble smoke tests.md](file:///Users/doniv/x.md)",
			),
		).toBe("@Shared Links Bubble smoke tests.md");
	});

	it("renders a wikilink alias to the alias", () => {
		expect(formatSessionTitle("[[Some Note|Display Name]]")).toBe(
			"Display Name",
		);
	});

	it("renders a bare wikilink to its target", () => {
		expect(formatSessionTitle("[[Some Note]]")).toBe("Some Note");
	});

	it("strips an embed marker on a wikilink", () => {
		expect(formatSessionTitle("![[Some Note]]")).toBe("Some Note");
	});

	it("collapses newlines and runs of whitespace to single spaces", () => {
		expect(
			formatSessionTitle("Do these actions now\n\n  do not   describe"),
		).toBe("Do these actions now do not describe");
	});

	it("falls back for null / undefined / empty / whitespace-only", () => {
		expect(formatSessionTitle(undefined)).toBe(DEFAULT_SESSION_TITLE);
		expect(formatSessionTitle(null)).toBe(DEFAULT_SESSION_TITLE);
		expect(formatSessionTitle("")).toBe(DEFAULT_SESSION_TITLE);
		expect(formatSessionTitle("   \n ")).toBe(DEFAULT_SESSION_TITLE);
	});

	it("honors a custom fallback", () => {
		expect(formatSessionTitle("", "No title")).toBe("No title");
	});

	it("does NOT truncate long titles (width is CSS's job)", () => {
		const long = "x".repeat(200);
		expect(formatSessionTitle(long)).toBe(long);
		expect(formatSessionTitle(long).length).toBe(200);
	});

	it("never throws on odd input (total function)", () => {
		expect(() => formatSessionTitle("[unclosed](")).not.toThrow();
		expect(() => formatSessionTitle("[[unclosed")).not.toThrow();
	});
});
