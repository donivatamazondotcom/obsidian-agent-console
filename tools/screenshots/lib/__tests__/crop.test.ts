/**
 * Tests for crop region math.
 *
 * The driver gets element bounds from `dev:cdp Runtime.evaluate
 * getBoundingClientRect()` (CSS pixels) and the screenshot from
 * `dev:screenshot` (device pixels — depends on retina scaling). The crop
 * pipeline must reconcile these.
 *
 * TDD layer 1: pure math, no I/O.
 */
import { describe, expect, it } from "vitest";
import {
	computeCropRect,
	scaleRectByDevicePixelRatio,
	unionRects,
	computeCenterExtend,
	rectIntersects,
} from "../crop";

describe("scaleRectByDevicePixelRatio", () => {
	it("scales identity at DPR=1", () => {
		expect(
			scaleRectByDevicePixelRatio(
				{ x: 0, y: 40, width: 44, height: 1248 },
				1,
			),
		).toEqual({ x: 0, y: 40, width: 44, height: 1248 });
	});

	it("doubles at DPR=2 (retina)", () => {
		expect(
			scaleRectByDevicePixelRatio(
				{ x: 10, y: 20, width: 100, height: 200 },
				2,
			),
		).toEqual({ x: 20, y: 40, width: 200, height: 400 });
	});

	it("rounds half-pixels conservatively (floor x/y, ceil w/h to never miss content)", () => {
		// At DPR=2.0 with a fractional CSS bound, ensure no off-by-one.
		expect(
			scaleRectByDevicePixelRatio(
				{ x: 1.5, y: 2.5, width: 10.5, height: 20.5 },
				2,
			),
		).toEqual({ x: 3, y: 5, width: 21, height: 41 });
	});

	it("rejects DPR <= 0", () => {
		expect(() =>
			scaleRectByDevicePixelRatio(
				{ x: 0, y: 0, width: 10, height: 10 },
				0,
			),
		).toThrow(/devicePixelRatio/);
	});
});

describe("computeCropRect", () => {
	it("returns the manifest crop verbatim when no padding given", () => {
		const result = computeCropRect(
			{ x: 0, y: 40, width: 44, height: 1248 },
			{ padding: 0 },
		);
		expect(result).toEqual({ x: 0, y: 40, width: 44, height: 1248 });
	});

	it("expands by uniform padding without going negative", () => {
		const result = computeCropRect(
			{ x: 100, y: 100, width: 50, height: 50 },
			{ padding: 10 },
		);
		expect(result).toEqual({ x: 90, y: 90, width: 70, height: 70 });
	});

	it("clamps x/y at 0 when padding would push negative", () => {
		const result = computeCropRect(
			{ x: 5, y: 5, width: 50, height: 50 },
			{ padding: 10 },
		);
		expect(result).toEqual({ x: 0, y: 0, width: 60, height: 60 });
	});

	it("clamps right/bottom at imageBounds when given", () => {
		const result = computeCropRect(
			{ x: 90, y: 90, width: 50, height: 50 },
			{ padding: 20, imageBounds: { width: 100, height: 100 } },
		);
		// x=70, y=70, but right=70+50+40=160 > 100 so width clamps to 30; same for height
		expect(result).toEqual({ x: 70, y: 70, width: 30, height: 30 });
	});
});

describe("unionRects", () => {
	it("returns the single rect unchanged for a one-element list", () => {
		expect(unionRects([{ x: 10, y: 20, width: 30, height: 40 }])).toEqual({
			x: 10,
			y: 20,
			width: 30,
			height: 40,
		});
	});

	it("computes the bounding box of multiple rects", () => {
		// Four 30×26 icons in a row at x=1266,1298,1330,1362, y=81.
		const rects = [
			{ x: 1266, y: 81, width: 30, height: 26 },
			{ x: 1298, y: 81, width: 30, height: 26 },
			{ x: 1330, y: 81, width: 30, height: 26 },
			{ x: 1362, y: 81, width: 30, height: 26 },
		];
		expect(unionRects(rects)).toEqual({ x: 1266, y: 81, width: 126, height: 26 });
	});

	it("handles rects of differing heights/positions", () => {
		const rects = [
			{ x: 0, y: 50, width: 10, height: 10 },
			{ x: 100, y: 0, width: 10, height: 80 },
		];
		expect(unionRects(rects)).toEqual({ x: 0, y: 0, width: 110, height: 80 });
	});

	it("throws on empty input", () => {
		expect(() => unionRects([])).toThrow(/empty/);
	});
});

describe("computeCenterExtend", () => {
	it("centers content inside a larger target", () => {
		// 126×26 content in 298×96 target → 86 each side horiz, 35 each vert
		expect(computeCenterExtend(126, 26, 298, 96)).toEqual({
			left: 86,
			right: 86,
			top: 35,
			bottom: 35,
		});
	});

	it("biases the odd remainder to right/bottom", () => {
		// dw=3 → left 1, right 2; dh=1 → top 0, bottom 1
		expect(computeCenterExtend(10, 10, 13, 11)).toEqual({
			left: 1,
			right: 2,
			top: 0,
			bottom: 1,
		});
	});

	it("returns zero offsets when content meets target", () => {
		expect(computeCenterExtend(100, 50, 100, 50)).toEqual({
			left: 0,
			right: 0,
			top: 0,
			bottom: 0,
		});
	});

	it("clamps to zero when content exceeds target (caller must guard)", () => {
		expect(computeCenterExtend(400, 300, 100, 100)).toEqual({
			left: 0,
			right: 0,
			top: 0,
			bottom: 0,
		});
	});
});

describe("rectIntersects", () => {
	it("returns true for overlapping rects", () => {
		expect(
			rectIntersects(
				{ x: 0, y: 0, width: 100, height: 100 },
				{ x: 50, y: 50, width: 100, height: 100 },
			),
		).toBe(true);
	});

	it("returns true when one rect contains the other", () => {
		expect(
			rectIntersects(
				{ x: 0, y: 0, width: 1000, height: 1000 },
				{ x: 100, y: 100, width: 10, height: 10 },
			),
		).toBe(true);
	});

	it("returns false for fully disjoint rects", () => {
		expect(
			rectIntersects(
				{ x: 0, y: 0, width: 100, height: 100 },
				{ x: 500, y: 500, width: 50, height: 50 },
			),
		).toBe(false);
	});

	it("returns false for edge-only touching (strict overlap)", () => {
		// a's right edge (x=100) exactly meets b's left edge (x=100): no area.
		expect(
			rectIntersects(
				{ x: 0, y: 0, width: 100, height: 100 },
				{ x: 100, y: 0, width: 100, height: 100 },
			),
		).toBe(false);
	});

	it("returns true for a small overlap past the edge", () => {
		expect(
			rectIntersects(
				{ x: 0, y: 0, width: 100, height: 100 },
				{ x: 99, y: 0, width: 100, height: 100 },
			),
		).toBe(true);
	});
});
