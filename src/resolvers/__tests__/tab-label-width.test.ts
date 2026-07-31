/**
 * Tests for `deriveActiveTabLabelMax` — the greedy-active-tab-label resolver.
 *
 * See [[Greedy active tab label]] T01. Asserts literal expected widths (no
 * re-implementation of the production arithmetic — R5), covering the
 * subtract-when-room case, the floor when the leaf is narrow, and the
 * negative-subtraction guard.
 */
import { describe, it, expect } from "vitest";
import {
	deriveActiveTabLabelMax,
	TAB_CHROME_WIDTH,
	TAB_NEIGHBOR_PEEK,
	ACTIVE_LABEL_FLOOR,
} from "../tab-label-width";

describe("deriveActiveTabLabelMax", () => {
	it("subtracts chrome + peek when the strip has room", () => {
		expect(
			deriveActiveTabLabelMax({
				containerWidth: 400,
				chromeWidth: 62,
				peek: 48,
				floor: 160,
			}),
		).toBe(290);
	});

	it("floors to the readability floor when available < floor but the floor still fits chrome", () => {
		// 250 − 62 − 48 = 140 < 160 → floor; 160 + 62 = 222 ≤ 250, close button fits.
		expect(
			deriveActiveTabLabelMax({
				containerWidth: 250,
				chromeWidth: 62,
				peek: 48,
				floor: 160,
			}),
		).toBe(160);
	});

	it("clamps below the floor so label + chrome never exceeds the strip (TS-I06)", () => {
		// 200 − 62 = 138 < 160 floor → clamp to 138 so the close button (in the
		// chrome) stays visible. Pre-fix this returned the 160 floor (222 > 200,
		// close button clipped).
		expect(
			deriveActiveTabLabelMax({
				containerWidth: 200,
				chromeWidth: 62,
				peek: 48,
				floor: 160,
			}),
		).toBe(138);
	});

	it("shrinks toward zero in a very narrow leaf, keeping chrome visible", () => {
		// 100 − 62 = 38. Pre-fix returned the 160 floor.
		expect(
			deriveActiveTabLabelMax({
				containerWidth: 100,
				chromeWidth: 62,
				peek: 48,
				floor: 160,
			}),
		).toBe(38);
	});

	it("never returns negative when the container is narrower than the chrome", () => {
		expect(
			deriveActiveTabLabelMax({
				containerWidth: 50,
				chromeWidth: 62,
				peek: 48,
				floor: 160,
			}),
		).toBe(0);
	});

	it("returns the floor for a non-finite (pre-layout) container width", () => {
		expect(
			deriveActiveTabLabelMax({
				containerWidth: Number.NaN,
				chromeWidth: 62,
				peek: 48,
				floor: 160,
			}),
		).toBe(160);
	});

	it("uses the exported constants to produce the expected wide-leaf cap", () => {
		// 900 − 64 − 48 = 788, above the 160 floor and below 900 − 64 = 836.
		expect(
			deriveActiveTabLabelMax({
				containerWidth: 900,
				chromeWidth: TAB_CHROME_WIDTH,
				peek: TAB_NEIGHBOR_PEEK,
				floor: ACTIVE_LABEL_FLOOR,
			}),
		).toBe(788);
	});
});
