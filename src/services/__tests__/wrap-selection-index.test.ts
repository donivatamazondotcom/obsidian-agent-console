/**
 * QP-I17 — wrapSelectionIndex: circular keyboard navigation for the `!`
 * launcher dropdown. The Create row is always last (maxIndex), so a single `up`
 * from the top lands on it predictably.
 */
import { describe, it, expect } from "vitest";
import { wrapSelectionIndex } from "../quick-prompts-logic";

describe("wrapSelectionIndex (QP-I17 circular nav)", () => {
	// 3 prompts + a Create row → maxIndex = 3 (indices 0,1,2 = prompts, 3 = create)
	const maxIndex = 3;

	it("down advances by one within range", () => {
		expect(wrapSelectionIndex(0, maxIndex, "down")).toBe(1);
		expect(wrapSelectionIndex(2, maxIndex, "down")).toBe(3);
	});

	it("down past the last row wraps to the top", () => {
		expect(wrapSelectionIndex(maxIndex, maxIndex, "down")).toBe(0);
	});

	it("up retreats by one within range", () => {
		expect(wrapSelectionIndex(3, maxIndex, "up")).toBe(2);
		expect(wrapSelectionIndex(1, maxIndex, "up")).toBe(0);
	});

	it("up from the top wraps to the last row (the Create row)", () => {
		expect(wrapSelectionIndex(0, maxIndex, "up")).toBe(maxIndex);
	});

	it("single-row list (only the Create row) wraps to itself", () => {
		expect(wrapSelectionIndex(0, 0, "up")).toBe(0);
		expect(wrapSelectionIndex(0, 0, "down")).toBe(0);
	});

	it("empty (maxIndex < 0) stays at 0", () => {
		expect(wrapSelectionIndex(0, -1, "up")).toBe(0);
		expect(wrapSelectionIndex(0, -1, "down")).toBe(0);
	});
});
