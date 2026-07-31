/**
 * Tests for `deriveTabScrollLeft` — keeps the active tab in view (TS-I07).
 *
 * The resize-shrink case is the reproduction: after the strip narrows, the
 * active tab sits off the right edge and must be scrolled back into view.
 */
import { describe, it, expect } from "vitest";
import { deriveTabScrollLeft } from "../tab-scroll";

describe("deriveTabScrollLeft", () => {
	it("scrolls right to reveal an active tab pushed off the right edge (resize-shrink, TS-I07)", () => {
		// Strip [0,174] shrank around an active tab now at [400,573]; scrollLeft 0.
		expect(
			deriveTabScrollLeft({
				containerLeft: 0,
				containerRight: 174,
				tabLeft: 400,
				tabRight: 573,
				scrollLeft: 0,
			}),
		).toBe(399); // 0 + (573 − 174)
	});

	it("scrolls left to reveal an active tab off the left edge", () => {
		expect(
			deriveTabScrollLeft({
				containerLeft: 100,
				containerRight: 300,
				tabLeft: 60,
				tabRight: 210,
				scrollLeft: 80,
			}),
		).toBe(40); // 80 − (100 − 60)
	});

	it("leaves scrollLeft unchanged when the active tab is already fully visible", () => {
		expect(
			deriveTabScrollLeft({
				containerLeft: 0,
				containerRight: 300,
				tabLeft: 10,
				tabRight: 180,
				scrollLeft: 5,
			}),
		).toBe(5);
	});

	it("never returns a negative scrollLeft", () => {
		// Off the left by more than the current scrollLeft → floors at 0.
		expect(
			deriveTabScrollLeft({
				containerLeft: 100,
				containerRight: 300,
				tabLeft: 0,
				tabRight: 150,
				scrollLeft: 20,
			}),
		).toBe(0); // max(0, 20 − 100)
	});
});
