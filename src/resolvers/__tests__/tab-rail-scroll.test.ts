/**
 * Vertical tab rail – keep the active key in view by scrolling only the key
 * list (never an ancestor). Mirror of `deriveTabScrollLeft`.
 */
import { describe, it, expect } from "vitest";
import { deriveRailScrollTop } from "../tab-rail-scroll";

describe("deriveRailScrollTop", () => {
	const list = { listTop: 100, listBottom: 300 };
	it("leaves a fully visible key alone", () => {
		expect(
			deriveRailScrollTop({ ...list, keyTop: 150, keyBottom: 178, scrollTop: 40 }),
		).toBe(40);
	});
	it("scrolls up to a key above the view", () => {
		expect(
			deriveRailScrollTop({ ...list, keyTop: 80, keyBottom: 108, scrollTop: 40 }),
		).toBe(20);
	});
	it("scrolls down to a key below the view", () => {
		expect(
			deriveRailScrollTop({ ...list, keyTop: 290, keyBottom: 318, scrollTop: 40 }),
		).toBe(58);
	});
	it("a key taller than the list aligns to its top", () => {
		expect(
			deriveRailScrollTop({ listTop: 100, listBottom: 120, keyTop: 130, keyBottom: 160, scrollTop: 0 }),
		).toBe(30);
	});
	it("never returns a negative scroll", () => {
		expect(
			deriveRailScrollTop({ ...list, keyTop: 50, keyBottom: 78, scrollTop: 10 }),
		).toBe(0);
	});
});
