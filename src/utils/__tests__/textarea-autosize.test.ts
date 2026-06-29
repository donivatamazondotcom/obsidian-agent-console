import { describe, expect, it } from "vitest";
import {
	clampTextareaHeight,
	decideTextareaResize,
	TEXTAREA_MAX_HEIGHT,
	TEXTAREA_MIN_HEIGHT,
} from "../textarea-autosize";

describe("clampTextareaHeight", () => {
	it.each([
		[0, TEXTAREA_MIN_HEIGHT],
		[40, TEXTAREA_MIN_HEIGHT],
		[TEXTAREA_MIN_HEIGHT, TEXTAREA_MIN_HEIGHT],
		[150, 150],
		[TEXTAREA_MAX_HEIGHT, TEXTAREA_MAX_HEIGHT],
		[400, TEXTAREA_MAX_HEIGHT],
		[100000, TEXTAREA_MAX_HEIGHT],
	])("clamps %i px into [min,max] => %i", (input, expected) => {
		expect(clampTextareaHeight(input)).toBe(expected);
	});

	it("honors custom bounds", () => {
		expect(clampTextareaHeight(500, 100, 200)).toBe(200);
		expect(clampTextareaHeight(50, 100, 200)).toBe(100);
		expect(clampTextareaHeight(150, 100, 200)).toBe(150);
	});
});

describe("decideTextareaResize", () => {
	// ── The I-S13 regression guard ──────────────────────────────────────────
	// When the composer is overflowing at max-height, the resolver MUST return
	// `apply` (height === max) and NEVER `measure-collapsed`. The collapse path
	// is what toggled `height: auto` and relaid out the flex layout, reverting
	// the message list's scrollTop and unpinning the chat. Keeping the hot path
	// off the collapse branch is the fix.
	it("overflowing at max-height → apply max (NO collapse toggle)", () => {
		const d = decideTextareaResize({ scrollHeight: 2000, clientHeight: 300 });
		expect(d.kind).toBe("apply");
		expect(d).toEqual({ kind: "apply", heightPx: TEXTAREA_MAX_HEIGHT });
	});

	it("overflowing below max → apply the clamped content height", () => {
		expect(decideTextareaResize({ scrollHeight: 150, clientHeight: 100 })).toEqual({
			kind: "apply",
			heightPx: 150,
		});
	});

	it("overflowing but content below min → apply min", () => {
		expect(decideTextareaResize({ scrollHeight: 70, clientHeight: 60 })).toEqual({
			kind: "apply",
			heightPx: TEXTAREA_MIN_HEIGHT,
		});
	});

	it("not overflowing (scrollHeight === clientHeight) → measure-collapsed", () => {
		expect(decideTextareaResize({ scrollHeight: 120, clientHeight: 120 })).toEqual({
			kind: "measure-collapsed",
		});
	});

	it("not overflowing (scrollHeight < clientHeight) → measure-collapsed", () => {
		expect(decideTextareaResize({ scrollHeight: 80, clientHeight: 120 })).toEqual({
			kind: "measure-collapsed",
		});
	});

	it.each([301, 500, 1000, 5000])(
		"any overflow beyond max (scrollHeight=%i) clamps to max with no collapse",
		(sh) => {
			const d = decideTextareaResize({ scrollHeight: sh, clientHeight: 300 });
			expect(d).toEqual({ kind: "apply", heightPx: TEXTAREA_MAX_HEIGHT });
		},
	);

	it("respects custom min/max bounds", () => {
		expect(
			decideTextareaResize({ scrollHeight: 500, clientHeight: 200, min: 100, max: 250 }),
		).toEqual({ kind: "apply", heightPx: 250 });
	});
});
