/**
 * Tests for prompt template rendering.
 *
 * Prompt fixtures live at tools/screenshots/fixtures/prompts/<name>.txt
 * and may contain `{{var}}` tokens for substitution at runtime (e.g.,
 * date-stamps that would otherwise drift across regenerations).
 *
 * TDD layer 1: pure string transformation, no I/O.
 */
import { describe, expect, it } from "vitest";
import { renderPrompt } from "../prompts";

describe("renderPrompt", () => {
	it("returns input unchanged when there are no tokens", () => {
		expect(renderPrompt("hello world", {})).toBe("hello world");
	});

	it("substitutes a single token", () => {
		expect(renderPrompt("hello {{name}}", { name: "world" })).toBe(
			"hello world",
		);
	});

	it("substitutes multiple tokens", () => {
		expect(
			renderPrompt("{{greeting}}, {{name}}!", {
				greeting: "Hello",
				name: "Vinod",
			}),
		).toBe("Hello, Vinod!");
	});

	it("substitutes the same token multiple times", () => {
		expect(renderPrompt("{{x}} and {{x}}", { x: "yes" })).toBe(
			"yes and yes",
		);
	});

	it("throws when a token has no matching variable", () => {
		expect(() => renderPrompt("hello {{name}}", {})).toThrow(/name/);
	});

	it("throws listing all missing tokens at once for ergonomic debugging", () => {
		expect(() => renderPrompt("{{a}} {{b}} {{c}}", { a: "1" })).toThrow(
			/b.*c|c.*b/,
		);
	});

	it("ignores unused vars (not all templates use all vars)", () => {
		expect(renderPrompt("hello", { unused: "x" })).toBe("hello");
	});

	it("ignores tokens with internal whitespace (treats them as literal)", () => {
		// Decision: tokens are exactly `{{name}}`. Anything with internal
		// whitespace (`{{ name }}`, `{{name }}`, `{{my name}}`) is NOT a
		// token and is passed through unchanged. Pin this so we don't
		// accidentally add fuzzy matching that breaks deterministic
		// rendering — and so authors get an obvious "my token didn't
		// substitute" signal rather than silent partial matches.
		expect(renderPrompt("{{ name }}", { name: "x" })).toBe("{{ name }}");
		expect(renderPrompt("{{my name}}", { "my name": "x" })).toBe(
			"{{my name}}",
		);
	});
});
