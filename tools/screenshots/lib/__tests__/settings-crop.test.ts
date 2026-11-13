/**
 * The settings-shot crop: the visible content inside the crop element, not
 * the whole settings pane. Runs the real page expression against a jsdom
 * page whose layout (rects) mirrors Obsidian 1.15's settings DOM, as probed
 * on 2026-11-12 (pane 950 px wide, content column 700 px at x 375).
 */
import { describe, it, expect } from "vitest";
import { settingsContentBoxesExpression } from "../settings-crop";

type R = [number, number, number, number];

interface Node {
	cls: string;
	r: R;
	kids?: Node[];
	text?: string;
}

/** Build the DOM with stubbed layout, mounted in document.body. */
function mount(tree: Node): void {
	document.body.innerHTML = "";
	const make = (n: Node): HTMLElement => {
		const el = document.createElement("div");
		el.className = n.cls;
		if (n.text) el.textContent = n.text;
		const [x, y, width, height] = n.r;
		el.getBoundingClientRect = () => ({ x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON() {} }) as DOMRect;
		for (const k of n.kids ?? []) el.appendChild(make(k));
		return el;
	};
	document.body.appendChild(make(tree));
}

function rawBoxes(selectors: string[], inner: [number, number]): unknown {
	const win = { innerWidth: inner[0], innerHeight: inner[1], getComputedStyle: (el: Element) => window.getComputedStyle(el) };
	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	return new Function("activeDocument", "activeWindow", `return (${settingsContentBoxesExpression(selectors)});`)(document, win);
}

/** The boxes without their limit fields. */
function boxes(selectors: string[], inner: [number, number]): unknown {
	const out = rawBoxes(selectors, inner) as (Record<string, number> | null)[];
	return out.map((b) => (b ? { x: b.x, y: b.y, width: b.width, height: b.height } : b));
}

const row = (y: number, h: number): Node => ({ cls: "setting-item", r: [375, y, 700, h], kids: [{ cls: "setting-item-info", r: [395, y + 20, 500, h - 40], text: "x" }] });
const group = (y: number, rows: [number, number][], heading = true): Node => {
	const top = heading ? y + 35 : y;
	const end = rows.length ? rows[rows.length - 1][0] + rows[rows.length - 1][1] : top;
	return {
		cls: "setting-group",
		r: [375, y, 700, end - y],
		kids: [
			...(heading ? [{ cls: "setting-item setting-item-heading", r: [375, y, 700, 20] as R, kids: [{ cls: "setting-item-name", r: [391, y, 60, 20] as R, text: "H" }] }] : []),
			{ cls: "setting-group-search", r: [0, 0, 0, 0] },
			{ cls: "setting-items", r: [375, top, 700, end - top], kids: rows.map(([ry, rh]) => row(ry, rh)) },
		],
	};
};

describe("settingsContentBoxesExpression", () => {
	it("crops a settings sub-page to its title and content column, not the whole pane", () => {
		// settings-agent-page as probed: titlebar and content wrappers span the pane.
		mount({
			cls: "setting-page vertical-tab-content",
			r: [250, 30, 950, 870],
			kids: [
				{ cls: "setting-page-titlebar", r: [250, 30, 950, 36], kids: [
					{ cls: "clickable-icon setting-page-back-button", r: [375, 42, 28, 24], kids: [{ cls: "svg", r: [381, 46, 16, 16] }] },
					{ cls: "setting-page-title", r: [407, 46, 81, 17], text: "Claude Code" },
				] },
				{ cls: "setting-page-content", r: [250, 78, 950, 579], kids: [group(78, [[78, 92], [170, 108], [278, 70], [348, 101], [448, 101], [549, 108]], false)] },
			],
		});
		expect(boxes([".vertical-tab-content"], [1200, 900])).toEqual([{ x: 375, y: 42, width: 700, height: 615 }]);
	});

	it("drops a group the window edge cuts at the bottom, keeping the whole groups above it", () => {
		// settings-max-saved-chats: Sessions, Tabs, Permissions fit; the Export group is cut at 720.
		mount({
			cls: "vertical-tab-content",
			r: [250, 30, 950, 690],
			kids: [
				group(-427, [[-392, 92], [-300, 76]]),
				group(46, [[81, 92]]),
				group(197, [[233, 92], [325, 92], [417, 92]]),
				group(533, [[569, 92]]),
				group(685, [[685, 57], [742, 57]], false),
			],
		});
		expect(boxes([".vertical-tab-content"], [1200, 720])).toEqual([{ x: 375, y: 46, width: 700, height: 615 }]);
	});

	it("drops a cut group, heading and all, once whole groups are in the shot", () => {
		// settings-working-directory: Agents and Built-in agents fit; Custom agents' heading fits but its rows don't.
		mount({
			cls: "vertical-tab-content",
			r: [250, 30, 950, 870],
			kids: [group(46, [[81, 92], [173, 108]]), group(305, [[340, 57], [397, 57]]), group(478, [[513, 57], [570, 57]]), group(851, [[886, 57]])],
		});
		expect(boxes([".vertical-tab-content"], [1200, 900])).toEqual([{ x: 375, y: 46, width: 700, height: 581 }]);
	});

	it("on a sub-page taller than the window, keeps the title and the whole rows, not just the title", () => {
		// settings-agent-page in a 600 px window: the content group (78..657) is cut.
		mount({
			cls: "setting-page vertical-tab-content",
			r: [250, 30, 950, 570],
			kids: [
				{ cls: "setting-page-titlebar", r: [250, 30, 950, 36], kids: [
					{ cls: "clickable-icon setting-page-back-button", r: [375, 42, 28, 24], kids: [{ cls: "svg", r: [381, 46, 16, 16] }] },
					{ cls: "setting-page-title", r: [407, 46, 81, 17], text: "Claude Code" },
				] },
				{ cls: "setting-page-content", r: [250, 78, 950, 579], kids: [group(78, [[78, 92], [170, 108], [278, 70], [348, 101], [448, 101], [549, 108]], false)] },
			],
		});
		// Title (42..66) plus the rows that fit above 600: 78..549.
		expect(boxes([".vertical-tab-content"], [1200, 600])).toEqual([{ x: 375, y: 42, width: 700, height: 507 }]);
	});

	it("returns the dropped units' nearest edge, so padding never reaches into them", () => {
		// Two cards 8 px apart; the second is cut by the window.
		mount({ cls: "vertical-tab-content", r: [250, 30, 950, 570], kids: [
			{ cls: "card", r: [375, 50, 700, 300], kids: [{ cls: "t", r: [395, 60, 100, 20], text: "a" }] },
			{ cls: "card", r: [375, 358, 700, 400], kids: [{ cls: "t", r: [395, 368, 100, 20], text: "b" }] },
		] });
		const out = rawBoxes([".vertical-tab-content"], [1200, 600]) as { x: number; y: number; width: number; height: number; limitBottom?: number }[];
		expect(out[0]).toMatchObject({ x: 375, y: 50, width: 700, height: 300, limitBottom: 358 });
	});

	it("in a headed group taller than the window, keeps the heading and the whole rows", () => {
		mount({ cls: "vertical-tab-content", r: [250, 30, 950, 690], kids: [group(40, [[75, 300], [375, 300], [675, 100]])] });
		// Heading 40..60 and rows 75..675 fit in 720; the last row is cut.
		expect(boxes([".vertical-tab-content"], [1200, 720])).toEqual([{ x: 375, y: 40, width: 700, height: 635 }]);
	});

	it("in a group taller than the window, keeps whole rows and drops rows cut at either edge", () => {
		mount({
			cls: "vertical-tab-content",
			r: [250, 30, 950, 690],
			kids: [group(0, [[10, 60], [70, 300], [370, 300], [670, 100]])],
		});
		// Heading (0..20) and the first row (10..70) start above the pane top (30), so they are cut; 70..670 fits; 670..770 is cut.
		expect(boxes([".vertical-tab-content"], [1200, 720])).toEqual([{ x: 375, y: 70, width: 700, height: 600 }]);
	});

	it("keeps a crop element that is itself one setting row as it is", () => {
		mount({ cls: "vertical-tab-content", r: [250, 30, 950, 870], kids: [group(100, [[135, 92], [227, 92]])] });
		const rows = document.querySelectorAll(".setting-items > .setting-item");
		rows[0].classList.add("pick");
		expect(boxes([".pick"], [1200, 900])).toEqual([{ x: 375, y: 135, width: 700, height: 92 }]);
	});

	it("returns null for a selector that matches nothing", () => {
		mount({ cls: "vertical-tab-content", r: [250, 30, 950, 870], kids: [] });
		expect(boxes([".vertical-tab-content", ".gone"], [1200, 900])).toEqual([{ x: 250, y: 30, width: 950, height: 870 }, null]);
	});
});
