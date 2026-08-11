/**
 * replaceMention — context-aware whitespace + end-of-reference caret.
 *
 * Reproduces the reported bug: selecting an `@` note mid-composer produced
 * incorrect whitespace (a leading space at position 0, doubled spaces when a
 * space already surrounded the token) and the returned caret must land at the
 * END OF THE INSERTED REFERENCE, not the end of the whole composer text.
 *
 * Red-first (R1): against the old `replaceMention` — which built an
 * unconditional `" @[[Note]] "` — the whitespace assertions fail (leading space
 * where none is wanted, doubled spaces). Spec: [[Unified Picker Control]].
 */
import { describe, it, expect } from "vitest";
import { detectMention, replaceMention } from "../mention-parser";

describe("replaceMention — context-aware whitespace", () => {
	it("adds no leading space at the start of the composer", () => {
		const ctx = detectMention("@doc", 4)!;
		const { newText } = replaceMention("@doc", ctx, "Document");
		expect(newText.startsWith("@[[Document]]")).toBe(true);
		expect(newText.startsWith(" ")).toBe(false);
	});

	it("does not double a space that already precedes/follows the token", () => {
		const text = "a @doc b";
		const ctx = detectMention(text, 6)!; // caret after "@doc"
		const { newText } = replaceMention(text, ctx, "Document");
		expect(newText).toBe("a @[[Document]] b");
		expect(newText.includes("  ")).toBe(false);
	});

	it("adds both spaces when inserting between non-space neighbours", () => {
		const text = "(@doc)";
		const ctx = detectMention(text, 5)!; // caret after "doc", before ")"
		const { newText } = replaceMention(text, ctx, "Document");
		expect(newText).toBe("( @[[Document]] )");
	});
});

describe("replaceMention — caret lands at end of the inserted reference", () => {
	it("returns a caret AFTER the reference, not at end of composer text", () => {
		const text = "a @doc b";
		const ctx = detectMention(text, 6)!;
		const { newText, newCursorPos } = replaceMention(
			text,
			ctx,
			"Document",
		);
		// end-of-reference, strictly before the trailing " b"
		expect(newCursorPos).toBeLessThan(newText.length);
		expect(newText.slice(0, newCursorPos)).toBe("a @[[Document]]");
		expect(newText.slice(newCursorPos)).toBe(" b");
	});
});
