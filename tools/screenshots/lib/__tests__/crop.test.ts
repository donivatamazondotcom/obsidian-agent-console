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
import { computeCropRect, scaleRectByDevicePixelRatio } from "../crop";

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
