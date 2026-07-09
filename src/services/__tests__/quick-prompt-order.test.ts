/**
 * Unit tests for Quick Prompt ordering — the `order:` frontmatter sort key.
 *
 * Covers T01–T03 from [[Agent Console Quick Prompt Ordering]] § Test Cases.
 * Pure logic + library sort point; no Obsidian harness (the real
 * VaultQuickPromptSource wiring is covered by the human smoke test).
 */
import { describe, it, expect, vi } from "vitest";
import {
	sortQuickPrompts,
	parseOrder,
	buildQuickPrompt,
} from "../quick-prompts-logic";
import { QuickPromptLibrary, type QuickPromptSource } from "../quick-prompts";
import type {
	QuickPrompt,
	QuickPromptFileInput,
} from "../../types/quick-prompt";

/** Minimal QuickPrompt builder — only the fields the sort reads. */
function qp(label: string, order?: number): QuickPrompt {
	return {
		id: label.toLowerCase(),
		label,
		body: "",
		path: `Quick Prompts/${label}.md`,
		usesSelection: false,
		order,
	};
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("quick-prompt ordering", () => {
	// ========================================================================
	// T01 — sortQuickPrompts
	// ========================================================================
	describe("T01: sortQuickPrompts", () => {
		it("sorts numeric `order` ascending", () => {
			const out = sortQuickPrompts([qp("B", 2), qp("A", 1)]);
			expect(out.map((p) => p.label)).toEqual(["A", "B"]);
		});

		it("puts `order: 0` before `order: 1`", () => {
			const out = sortQuickPrompts([qp("x", 1), qp("y", 0)]);
			expect(out.map((p) => p.label)).toEqual(["y", "x"]);
		});

		it("honours negative order (ascending, so -1 before 0)", () => {
			const out = sortQuickPrompts([qp("zero", 0), qp("neg", -1)]);
			expect(out.map((p) => p.label)).toEqual(["neg", "zero"]);
		});

		it("sorts prompts without `order` after all numeric ones, alphabetically", () => {
			const out = sortQuickPrompts([
				qp("Mango"),
				qp("Zebra", 0),
				qp("apple"),
			]);
			expect(out.map((p) => p.label)).toEqual(["Zebra", "apple", "Mango"]);
		});

		it("breaks equal `order` alphabetically by label (case-insensitive)", () => {
			const out = sortQuickPrompts([qp("banana", 1), qp("Apple", 1)]);
			expect(out.map((p) => p.label)).toEqual(["Apple", "banana"]);
		});

		it("sorts a no-`order`-anywhere set purely alphabetically (case-insensitive)", () => {
			const out = sortQuickPrompts([
				qp("Charlie"),
				qp("alpha"),
				qp("Bravo"),
			]);
			expect(out.map((p) => p.label)).toEqual([
				"alpha",
				"Bravo",
				"Charlie",
			]);
		});

		it("returns an empty array for empty input", () => {
			expect(sortQuickPrompts([])).toEqual([]);
		});

		it("QPO-I01: a string-typed order still sorts numerically", () => {
			// buildQuickPrompt coerces "0" -> 0 upstream; sort receives a number.
			const first = { ...qp("New prompt"), order: 0 };
			const out = sortQuickPrompts([qp("go"), first, qp("Prep now")]);
			expect(out.map((p) => p.label)).toEqual(["New prompt", "go", "Prep now"]);
		});

		it("is deterministic regardless of input order and does not mutate the input", () => {
			const input = [qp("B", 2), qp("A", 1), qp("z"), qp("a")];
			const snapshot = input.map((p) => p.label);
			const a = sortQuickPrompts(input).map((p) => p.label);
			const b = sortQuickPrompts([...input].reverse()).map((p) => p.label);
			expect(a).toEqual(["A", "B", "a", "z"]);
			expect(b).toEqual(a);
			// input untouched
			expect(input.map((p) => p.label)).toEqual(snapshot);
		});
	});

	// ========================================================================
	// T02 — parseOrder / buildQuickPrompt
	// ========================================================================
	describe("T02: order parsing", () => {
		it("parseOrder keeps finite numbers, including 0 and negatives", () => {
			expect(parseOrder(0)).toBe(0);
			expect(parseOrder(5)).toBe(5);
			expect(parseOrder(-2)).toBe(-2);
		});

		it("parseOrder rejects non-finite, non-number, and missing values", () => {
			expect(parseOrder(NaN)).toBeUndefined();
			expect(parseOrder(Infinity)).toBeUndefined();
			expect(parseOrder(true)).toBeUndefined();
			expect(parseOrder(null)).toBeUndefined();
			expect(parseOrder(undefined)).toBeUndefined();
		});

		it("QPO-I01: coerces numeric strings (Obsidian Text-typed order property)", () => {
			// A number typed into a Text-typed frontmatter property arrives as a
			// string. Coerce it so `order: 0` pins regardless of property type.
			expect(parseOrder("0")).toBe(0);
			expect(parseOrder("3")).toBe(3);
			expect(parseOrder("  5 ")).toBe(5);
			expect(parseOrder("-2")).toBe(-2);
			// Guard: an empty / whitespace / non-numeric string is NOT 0 — unset.
			expect(parseOrder("")).toBeUndefined();
			expect(parseOrder("   ")).toBeUndefined();
			expect(parseOrder("abc")).toBeUndefined();
		});

		it("buildQuickPrompt carries a numeric order (including 0)", () => {
			const mk = (fm: Record<string, unknown> | null): QuickPromptFileInput => ({
				path: "Quick Prompts/p.md",
				basename: "p",
				frontmatter: fm,
				body: "hello",
			});
			expect(buildQuickPrompt(mk({ order: 5 })).order).toBe(5);
			expect(buildQuickPrompt(mk({ order: 0 })).order).toBe(0);
			expect(buildQuickPrompt(mk({ order: "3" })).order).toBe(3);
			expect(buildQuickPrompt(mk({ order: "abc" })).order).toBeUndefined();
			expect(buildQuickPrompt(mk({})).order).toBeUndefined();
			expect(buildQuickPrompt(mk(null)).order).toBeUndefined();
		});
	});

	// ========================================================================
	// T03 — library returns sorted prompts
	// ========================================================================
	describe("T03: QuickPromptLibrary returns sorted prompts", () => {
		function fileWith(
			basename: string,
			order?: number,
		): QuickPromptFileInput {
			const fm: Record<string, unknown> = { label: basename };
			if (order !== undefined) fm.order = order;
			return { path: `Quick Prompts/${basename}.md`, basename, frontmatter: fm, body: "b" };
		}

		it("getPrompts() is sorted by order then alphabetically", async () => {
			const files = [
				fileWith("Prep now"), // unset
				fileWith("go", 0), // pinned first
				fileWith("Archive"), // unset
			];
			const source: QuickPromptSource = {
				load: vi.fn(async () => files),
				onChange: () => () => {},
			};
			const lib = new QuickPromptLibrary(source);
			await lib.init();
			await flush();
			expect(lib.getPrompts().map((p) => p.label)).toEqual([
				"go",
				"Archive",
				"Prep now",
			]);
		});
	});
});
