/**
 * Tab state icons — spec [[Tab Dropdown Status Indicators]], I238.
 *
 * Every tab state maps to one Lucide icon id. The strip's `TabStateIcon`
 * renders it with `setIcon`, and the chevron dropdown passes the same id to
 * `MenuItem.setIcon`, so the two surfaces can never drift.
 *
 * I238: these were Unicode text glyphs, which depend on the loaded font and
 * read poorly at 10 px (the paused ring was near-invisible on dark themes).
 * The ids below were checked against the Lucide set bundled in Obsidian
 * 1.14.5. The dropdown has no color or animation, so the shapes must differ.
 */
import { describe, it, expect } from "vitest";
import { stateIcon } from "../TabBar";
import type { TabState } from "../../types/tab";

const EXPECTED: Record<TabState, string> = {
	ready: "circle-dot",
	busy: "loader-circle",
	permission: "triangle-alert",
	error: "circle-x",
	disconnected: "circle",
	released: "moon",
};

describe("stateIcon (I238)", () => {
	it.each(Object.entries(EXPECTED))(
		"maps %s to Lucide icon %s",
		(state, icon) => {
			expect(stateIcon(state as TabState)).toBe(icon);
		},
	);

	// Shape is the only signal in the dropdown, so every state needs its own icon.
	it("returns a distinct icon id for every state", () => {
		const icons = (Object.keys(EXPECTED) as TabState[]).map(stateIcon);
		expect(new Set(icons).size).toBe(icons.length);
	});
});
