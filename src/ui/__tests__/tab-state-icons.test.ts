/**
 * Tab state icons — spec [[Tab Dropdown Status Indicators]], I238.
 *
 * Every tab state maps to one Lucide icon id (`stateIcon`) and one class
 * string (`stateIconClass`). The strip's `TabStateIcon` and the chevron
 * dropdown's in-title span both use the pair, so shape, color and animation
 * match on both surfaces (I278).
 *
 * I238: these were Unicode text glyphs, which depend on the loaded font and
 * read poorly at 10 px (the paused ring was near-invisible on dark themes).
 * The ids below were checked against the Lucide set bundled in Obsidian
 * 1.14.5. Shape stays the colorblind-safe signal, so the shapes must differ.
 */
import { describe, it, expect } from "vitest";
import { stateIcon, stateIconClass } from "../TabBar";
import type { TabState } from "../../types/tab";

const EXPECTED: Record<TabState, string> = {
	ready: "circle-dot",
	busy: "loader-circle",
	permission: "triangle-alert",
	error: "circle-x",
	disconnected: "circle",
	released: "moon",
	// Tab Attention States
	doneUnseen: "check",
	stoppedUnseen: "circle-alert",
	connecting: "circle-dashed",
	// I316: last message failed, its error still shown
	failed: "message-circle-warning",
};

describe("stateIcon (I238)", () => {
	it.each(Object.entries(EXPECTED))(
		"maps %s to Lucide icon %s",
		(state, icon) => {
			expect(stateIcon(state as TabState)).toBe(icon);
		},
	);

	// Shape is the colorblind-safe signal, so every state needs its own icon.
	it("returns a distinct icon id for every state", () => {
		const icons = (Object.keys(EXPECTED) as TabState[]).map(stateIcon);
		expect(new Set(icons).size).toBe(icons.length);
	});

	it.each(Object.keys(EXPECTED))(
		"stateIconClass(%s) is the base plus state class (I278)",
		(state) => {
			expect(stateIconClass(state as TabState)).toBe(
				`agent-client-tab-state-icon agent-client-tab-state-${state}`,
			);
		},
	);
});
