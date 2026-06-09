/**
 * Tests for the content guard (I11 follow-up).
 *
 * Pure-logic layer: counts distinct RGB colors in a decoded pixel buffer so
 * the orchestrator can reject blank/degraded captures. Keyed on RGB only
 * (alpha ignored) to match the committed-webp calibration surface.
 *
 * Test contract: tools/screenshots/lib/__tests__/content-guard.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
	countDistinctColors,
	DEFAULT_MIN_DISTINCT_COLORS,
} from "../content-guard";

/** Build a raw RGBA buffer from a list of [r,g,b] triples (alpha fixed 255). */
function rgba(pixels: Array<[number, number, number]>): Buffer {
	const buf = Buffer.alloc(pixels.length * 4);
	pixels.forEach(([r, g, b], i) => {
		buf[i * 4] = r;
		buf[i * 4 + 1] = g;
		buf[i * 4 + 2] = b;
		buf[i * 4 + 3] = 255;
	});
	return buf;
}

describe("countDistinctColors", () => {
	it("returns 1 for a uniform (blank) image", () => {
		const blank = rgba(Array.from({ length: 500 }, () => [10, 10, 10]));
		expect(countDistinctColors(blank, 4)).toBe(1);
	});

	it("counts each distinct RGB triple once", () => {
		const sweep = rgba(
			Array.from({ length: 256 }, (_, k) => [k, 0, 0]),
		);
		expect(countDistinctColors(sweep, 4)).toBe(256);
	});

	it("ignores alpha — same RGB with differing alpha is one color", () => {
		// Two pixels, identical RGB, different alpha. RGB-keyed → 1 color.
		const buf = Buffer.from([12, 34, 56, 255, 12, 34, 56, 0]);
		expect(countDistinctColors(buf, 4)).toBe(1);
	});

	it("respects the channel stride for 3-channel (RGB) buffers", () => {
		// 3 distinct RGB pixels, no alpha channel.
		const buf = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(countDistinctColors(buf, 3)).toBe(3);
	});

	it("returns 0 for an empty buffer", () => {
		expect(countDistinctColors(Buffer.alloc(0), 4)).toBe(0);
	});

	it("does not read past the buffer on a trailing partial pixel", () => {
		// 4 full RGBA pixels + 2 stray bytes (a partial pixel). The partial
		// must be skipped, not read out of bounds.
		const buf = Buffer.from([
			1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255, 4, 4, 4, 255, 9, 9,
		]);
		expect(countDistinctColors(buf, 4)).toBe(4);
	});

	it("throws when channels < 3 (no RGB to key on)", () => {
		expect(() => countDistinctColors(Buffer.from([1, 2]), 2)).toThrow(
			/at least 3 channels/,
		);
	});

	it("distinguishes a degraded capture from a healthy one (I11 shape)", () => {
		// Degraded ribbon-icon collapsed to few colors; healthy has many. The
		// guard's discriminator is exactly this count.
		const degraded = rgba(
			Array.from({ length: 1000 }, (_, k) => [k % 30, 0, 0]),
		);
		const healthy = rgba(
			Array.from({ length: 1000 }, (_, k) => [
				k % 256,
				Math.floor(k / 256),
				0,
			]),
		);
		expect(countDistinctColors(degraded, 4)).toBeLessThan(50);
		expect(countDistinctColors(healthy, 4)).toBeGreaterThan(800);
	});
});

describe("DEFAULT_MIN_DISTINCT_COLORS", () => {
	it("is a low blank-catcher floor (pinned at 50)", () => {
		// Pinned: per-entry floors do the calibrated work; the global default
		// only catches gross blanks without false-positiving simple shots.
		expect(DEFAULT_MIN_DISTINCT_COLORS).toBe(50);
	});
});
