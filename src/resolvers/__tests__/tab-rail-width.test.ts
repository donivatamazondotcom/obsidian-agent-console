/**
 * Vertical tab rail – width resolver ([[Agent Console Vertical Tab Rail]]
 * § Width resolver). Snap, clamp, keyboard steps and the toggle, all from one
 * pure module so the drag preview, the commit and the per-render clamp agree.
 */
import { describe, it, expect } from "vitest";
import {
	resolveRailWidth,
	maxNamedWidth,
	nextRailWidthFromKey,
	toggleRailWidth,
	showsCloseButton,
	RAIL_ICON_WIDTH,
} from "../tab-rail-width";

const WIDE = 1000;

describe("resolveRailWidth – snap and clamp", () => {
	it.each([
		[31, { mode: "icons", width: 32 }],
		[45, { mode: "icons", width: 32 }],
		[46, { mode: "names", width: 60 }],
		[59, { mode: "names", width: 60 }],
		[60, { mode: "names", width: 60 }],
		[150, { mode: "names", width: 150 }],
		[147.5, { mode: "names", width: 148 }],
		[260, { mode: "names", width: 260 }],
		[261, { mode: "names", width: 260 }],
	])("requested %s in a wide view → %o", (requested, expected) => {
		expect(resolveRailWidth({ requested, viewWidth: WIDE })).toEqual(
			expected,
		);
	});

	it("never leaves the chat narrower than 160px", () => {
		expect(resolveRailWidth({ requested: 220, viewWidth: 300 })).toEqual({
			mode: "names",
			width: 140,
		});
	});

	it("a view too narrow for names shows icons", () => {
		expect(resolveRailWidth({ requested: 200, viewWidth: 219 })).toEqual({
			mode: "icons",
			width: RAIL_ICON_WIDTH,
		});
	});

	it.each([NaN, Infinity, -Infinity])("non-finite request %s → icons", (r) => {
		expect(resolveRailWidth({ requested: r, viewWidth: WIDE }).mode).toBe(
			"icons",
		);
	});

	it("non-finite view width → icons", () => {
		expect(resolveRailWidth({ requested: 150, viewWidth: NaN }).mode).toBe(
			"icons",
		);
	});

	it("maxNamedWidth follows the view", () => {
		expect(maxNamedWidth(1000)).toBe(260);
		expect(maxNamedWidth(300)).toBe(140);
	});
});

describe("nextRailWidthFromKey – handle keyboard", () => {
	it("from icons, ArrowLeft jumps to 60", () => {
		expect(
			nextRailWidthFromKey({ rendered: 32, key: "ArrowLeft", viewWidth: WIDE }),
		).toEqual({ kind: "set", width: 60 });
	});
	it("at 60, ArrowRight goes to icons", () => {
		expect(
			nextRailWidthFromKey({ rendered: 60, key: "ArrowRight", viewWidth: WIDE }),
		).toEqual({ kind: "set", width: 32 });
	});
	it("ArrowLeft widens by 10, ArrowRight narrows by 10", () => {
		expect(
			nextRailWidthFromKey({ rendered: 150, key: "ArrowLeft", viewWidth: WIDE }),
		).toEqual({ kind: "set", width: 160 });
		expect(
			nextRailWidthFromKey({ rendered: 150, key: "ArrowRight", viewWidth: WIDE }),
		).toEqual({ kind: "set", width: 140 });
	});
	it("at max, ArrowLeft does nothing", () => {
		expect(
			nextRailWidthFromKey({ rendered: 260, key: "ArrowLeft", viewWidth: WIDE }),
		).toEqual({ kind: "none" });
	});
	it("too narrow for names, ArrowLeft does nothing", () => {
		expect(
			nextRailWidthFromKey({ rendered: 32, key: "ArrowLeft", viewWidth: 200 }),
		).toEqual({ kind: "none" });
	});
	it("steps start from the rendered width (stored 220, view 300 renders 140)", () => {
		expect(
			nextRailWidthFromKey({ rendered: 140, key: "ArrowRight", viewWidth: 300 }),
		).toEqual({ kind: "set", width: 130 });
	});
	it("ArrowLeft from icons in a narrow-but-named view goes to 60", () => {
		expect(
			nextRailWidthFromKey({ rendered: 32, key: "ArrowLeft", viewWidth: 300 }),
		).toEqual({ kind: "set", width: 60 });
	});
	it.each(["Enter", "ArrowUp", " ", "a"])("key %s → none", (key) => {
		expect(
			nextRailWidthFromKey({ rendered: 150, key, viewWidth: WIDE }),
		).toEqual({ kind: "none" });
	});
});

describe("toggleRailWidth", () => {
	it("from names records the STORED width, not the rendered one", () => {
		expect(
			toggleRailWidth({ stored: 220, namedWidth: 160, viewWidth: 300 }),
		).toEqual({ tabRailWidth: 32, tabRailNamedWidth: 220 });
	});
	it("from icons restores the named width", () => {
		expect(
			toggleRailWidth({ stored: 32, namedWidth: 180, viewWidth: WIDE }),
		).toEqual({ tabRailWidth: 180, tabRailNamedWidth: 180 });
	});
	it("from icons in a view too narrow for names still stores the named width", () => {
		expect(
			toggleRailWidth({ stored: 32, namedWidth: 180, viewWidth: 200 }),
		).toEqual({ tabRailWidth: 180, tabRailNamedWidth: 180 });
	});
});

// I301: the hover-only close button shows on named keys at 100 px and wider.
describe("showsCloseButton (I301)", () => {
	it.each([
		[32, false],
		[60, false],
		[99, false],
		[100, true],
		[160, true],
		[260, true],
	])("width %i → %s", (width, expected) => {
		expect(showsCloseButton(width)).toBe(expected);
	});
	it("non-finite widths never show it", () => {
		expect(showsCloseButton(Number.NaN)).toBe(false);
		expect(showsCloseButton(Number.POSITIVE_INFINITY)).toBe(false);
	});
});
