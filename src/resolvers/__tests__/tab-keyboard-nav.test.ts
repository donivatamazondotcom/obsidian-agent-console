/**
 * `deriveTabKeyTarget` truth table (TS-I08).
 *
 * Arrow/Home/End move keyboard focus across the session tab strip
 * (WAI-ARIA tabs pattern, manual activation). Enter/Space activation is
 * handled by the tab itself, not this resolver.
 */
import { describe, it, expect } from "vitest";
import { deriveTabKeyTarget } from "../tab-keyboard-nav";

describe("deriveTabKeyTarget", () => {
	it.each([
		// key, index, count, expected
		["ArrowRight", 0, 3, { kind: "focus", index: 1 }],
		["ArrowRight", 2, 3, { kind: "focus", index: 0 }], // wraps
		["ArrowLeft", 1, 3, { kind: "focus", index: 0 }],
		["ArrowLeft", 0, 3, { kind: "focus", index: 2 }], // wraps
		["Home", 2, 3, { kind: "focus", index: 0 }],
		["End", 0, 3, { kind: "focus", index: 2 }],
	] as const)("%s from %i of %i", (key, index, count, expected) => {
		expect(deriveTabKeyTarget({ key, index, count })).toEqual(expected);
	});

	it.each(["Enter", " ", "Tab", "ArrowUp", "ArrowDown", "a", "Delete"])(
		"ignores %j",
		(key) => {
			expect(deriveTabKeyTarget({ key, index: 1, count: 3 })).toEqual({
				kind: "none",
			});
		},
	);

	it("single tab: navigation keys are a no-op, not a self-move", () => {
		for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
			expect(deriveTabKeyTarget({ key, index: 0, count: 1 })).toEqual({
				kind: "none",
			});
		}
	});

	it("Home on the first tab / End on the last is a no-op", () => {
		expect(deriveTabKeyTarget({ key: "Home", index: 0, count: 3 })).toEqual({
			kind: "none",
		});
		expect(deriveTabKeyTarget({ key: "End", index: 2, count: 3 })).toEqual({
			kind: "none",
		});
	});

	it("is total: bad inputs return none, never throw", () => {
		expect(deriveTabKeyTarget({ key: "ArrowRight", index: 0, count: 0 })).toEqual({ kind: "none" });
		expect(deriveTabKeyTarget({ key: "ArrowRight", index: -1, count: 3 })).toEqual({ kind: "none" });
		expect(deriveTabKeyTarget({ key: "ArrowRight", index: 5, count: 3 })).toEqual({ kind: "none" });
	});
});
