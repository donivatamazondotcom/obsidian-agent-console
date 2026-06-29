import { describe, it, expect } from "vitest";
import { detectMention, replaceMention } from "../mention-parser";

describe("detectMention", () => {
	describe("bare @query — multi-word (spaces allowed)", () => {
		// Reproduces the reported bug: typing a space inside an @ mention
		// killed the dropdown, diverging from the quick switcher which
		// fuzzy-matches multi-word queries. The bare form must now carry
		// spaces through to the query so "agent con" matches "Agent Console".
		it("detects a multi-word query with a space", () => {
			const ctx = detectMention("@agent con", 10);
			expect(ctx).not.toBeNull();
			expect(ctx).toEqual({ start: 0, end: 10, query: "agent con" });
		});

		it("detects a multi-word query mid-sentence", () => {
			const text = "hello @agent con";
			const ctx = detectMention(text, text.length);
			expect(ctx).not.toBeNull();
			expect(ctx?.start).toBe(6);
			expect(ctx?.query).toBe("agent con");
		});

		it("still detects a single-word query", () => {
			const ctx = detectMention("@agent", 6);
			expect(ctx).toEqual({ start: 0, end: 6, query: "agent" });
		});

		it("carries a trailing space in the query", () => {
			const ctx = detectMention("@agent ", 7);
			expect(ctx?.query).toBe("agent ");
		});
	});

	describe("terminators", () => {
		it("terminates the mention at a newline", () => {
			// A mention cannot span lines — text after a newline ends it.
			expect(detectMention("@agent\ncon", 10)).toBeNull();
		});

		it("keeps the mention before the newline", () => {
			expect(detectMention("@agent\ncon", 6)).toEqual({
				start: 0,
				end: 6,
				query: "agent",
			});
		});

		it("returns null when there is no @", () => {
			expect(detectMention("agent con", 9)).toBeNull();
		});
	});

	describe("bracket form @[[...]] (unchanged)", () => {
		it("allows spaces while typing inside brackets", () => {
			const ctx = detectMention("@[[agent con", 12);
			expect(ctx?.query).toBe("agent con");
		});

		it("returns null when the caret is past a completed @[[...]]", () => {
			// Caret after the closing ]] means the mention is finished — not
			// an active mention to search on.
			const text = "@[[Agent Console]]";
			expect(detectMention(text, text.length)).toBeNull();
		});
	});

	describe("replaceMention round-trip with a spaced query", () => {
		it("replaces a multi-word bare mention with the bracket form", () => {
			const ctx = detectMention("@agent con", 10);
			expect(ctx).not.toBeNull();
			const { newText } = replaceMention(
				"@agent con",
				ctx!,
				"Agent Console",
			);
			expect(newText).toContain("@[[Agent Console]]");
		});
	});
});
