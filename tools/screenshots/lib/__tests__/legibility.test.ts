/**
 * Tests for the legibility floor (rubric P5).
 *
 * Pure math, no I/O. The orchestrator wires `checkLegibility` into the
 * static-crop (resize) path so an undersized source can't upscale-and-blur.
 *
 * Test contract: tools/screenshots/lib/__tests__/legibility.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
	checkLegibility,
	DEFAULT_MIN_LEGIBILITY_SCALE,
} from "../legibility";

describe("checkLegibility", () => {
	it("passes at exactly 1:1 (default floor, inclusive)", () => {
		const r = checkLegibility({
			sourceWidth: 800,
			sourceHeight: 600,
			targetWidth: 800,
			targetHeight: 600,
		});
		expect(r.ok).toBe(true);
		expect(r.scale).toBe(1);
		expect(r.minScale).toBe(DEFAULT_MIN_LEGIBILITY_SCALE);
	});

	it("passes when the source is larger than the target (downscale)", () => {
		const r = checkLegibility({
			sourceWidth: 1600,
			sourceHeight: 1200,
			targetWidth: 800,
			targetHeight: 600,
		});
		expect(r.ok).toBe(true);
		expect(r.scale).toBe(2);
	});

	it("fails when the source is smaller than the target (would upscale/blur)", () => {
		const r = checkLegibility({
			sourceWidth: 200,
			sourceHeight: 200,
			targetWidth: 800,
			targetHeight: 600,
		});
		expect(r.ok).toBe(false);
		// min(200/800, 200/600) = min(0.25, 0.333) = 0.25
		expect(r.scale).toBeCloseTo(0.25, 5);
		expect(r.limitingAxis).toBe("width");
	});

	it("uses the worst (most-upscaled) axis for scale", () => {
		// width ratio 1.5, height ratio 0.5 -> scale 0.5, height-limited
		const r = checkLegibility({
			sourceWidth: 1200,
			sourceHeight: 300,
			targetWidth: 800,
			targetHeight: 600,
		});
		expect(r.scale).toBe(0.5);
		expect(r.limitingAxis).toBe("height");
		expect(r.ok).toBe(false);
	});

	it("honors a tighter per-entry floor (hero retina headroom)", () => {
		// scale 1.5 clears the default (1) but fails a 2.0 floor.
		const r = checkLegibility({
			sourceWidth: 1200,
			sourceHeight: 900,
			targetWidth: 800,
			targetHeight: 600,
			minScale: 2,
		});
		expect(r.scale).toBe(1.5);
		expect(r.minScale).toBe(2);
		expect(r.ok).toBe(false);
	});

	it("honors a relaxed floor below 1 (reference shot tolerating mild upscale)", () => {
		const r = checkLegibility({
			sourceWidth: 600,
			sourceHeight: 450,
			targetWidth: 800,
			targetHeight: 600,
			minScale: 0.7,
		});
		expect(r.scale).toBe(0.75);
		expect(r.ok).toBe(true);
	});

	it("throws when a target dimension is <= 0", () => {
		expect(() =>
			checkLegibility({
				sourceWidth: 100,
				sourceHeight: 100,
				targetWidth: 0,
				targetHeight: 100,
			}),
		).toThrow(/targetWidth/);
		expect(() =>
			checkLegibility({
				sourceWidth: 100,
				sourceHeight: 100,
				targetWidth: 100,
				targetHeight: -5,
			}),
		).toThrow(/targetHeight/);
	});

	it("throws on negative/non-finite source dimensions", () => {
		expect(() =>
			checkLegibility({
				sourceWidth: -1,
				sourceHeight: 100,
				targetWidth: 100,
				targetHeight: 100,
			}),
		).toThrow(/source dimensions/);
	});
});
