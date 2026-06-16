/**
 * Tab Dropdown Status Indicators — spec [[Tab Dropdown Status Indicators]].
 *
 * The chevron (`˅`) dropdown lists every tab (including overflowed ones not in
 * the strip) and now prefixes each item with the tab's state glyph, so "which
 * session is busy / stuck / errored / done?" is answerable from the one surface
 * that shows all sessions at once.
 *
 * `stateGlyph` is the single source of truth: the strip's `TabStateIcon` and the
 * dropdown's `handleChevronClick` both call it, so they can never drift (T2).
 * These tests pin the glyph vocabulary (T1) and the colorblind-safe invariant
 * that the five shapes are mutually distinct (the dropdown loses color/animation,
 * so shape alone must disambiguate every state).
 */
import { describe, it, expect } from "vitest";
import { stateGlyph } from "../TabBar";
import type { TabState } from "../../types/tab";

const EXPECTED: Record<TabState, string> = {
	ready: "●",
	busy: "◐",
	permission: "△",
	error: "✕",
	disconnected: "○",
};

describe("stateGlyph (Tab Dropdown Status Indicators)", () => {
	// T1: Dropdown shows correct glyph per state.
	it.each(Object.entries(EXPECTED))(
		"maps %s → its colorblind-safe glyph",
		(state, glyph) => {
			expect(stateGlyph(state as TabState)).toBe(glyph);
		},
	);

	// T2 support: shape is the primary (and in the dropdown, the only) signal,
	// so all five glyphs must be mutually distinct.
	it("returns a distinct, non-empty glyph for every state", () => {
		const glyphs = (Object.keys(EXPECTED) as TabState[]).map(stateGlyph);
		expect(glyphs.every((g) => g.length > 0)).toBe(true);
		expect(new Set(glyphs).size).toBe(glyphs.length);
	});
});
