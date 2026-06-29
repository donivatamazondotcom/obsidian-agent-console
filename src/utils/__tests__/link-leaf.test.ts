/**
 * I35 — deriveNewLeaf delegates to Obsidian's `Keymap.isModEvent`.
 *
 * After the parity work landed on `Keymap.isModEvent` (the sanctioned resolver),
 * `deriveNewLeaf` is a thin passthrough: the modifier→pane mapping
 * (tab/split/window/middle) is Obsidian's responsibility, not ours, and cannot
 * be exercised in jsdom (the real `isModEvent` is provided by the Obsidian
 * runtime). These tests assert the wrapper's actual contract — that it forwards
 * the event to `isModEvent` and returns its result unchanged — rather than
 * re-asserting a mapping we no longer own.
 */
import { describe, it, expect, vi } from "vitest";

const { isModEvent } = vi.hoisted(() => ({ isModEvent: vi.fn() }));

vi.mock("obsidian", () => ({
	Keymap: { isModEvent },
}));

import { deriveNewLeaf, shouldOpenFromActivation } from "../link-leaf";

function mouse(init: Partial<MouseEvent>): MouseEvent {
	return {
		button: 0,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		...init,
	} as MouseEvent;
}

describe("deriveNewLeaf", () => {
	it("returns whatever Keymap.isModEvent returns, unchanged", () => {
		for (const ret of ["tab", "split", "window", false] as const) {
			isModEvent.mockReturnValue(ret);
			expect(deriveNewLeaf(mouse({}))).toBe(ret);
		}
	});

	it("forwards the exact event to Keymap.isModEvent", () => {
		isModEvent.mockReturnValue("tab");
		const evt = mouse({ button: 1, metaKey: true });
		deriveNewLeaf(evt);
		expect(isModEvent).toHaveBeenCalledWith(evt);
	});
});

describe("shouldOpenFromActivation", () => {
	it("opens on left-click (button 0)", () => {
		expect(shouldOpenFromActivation(mouse({ button: 0 }))).toBe(true);
	});

	it("opens on middle-click (button 1)", () => {
		expect(shouldOpenFromActivation(mouse({ button: 1 }))).toBe(true);
	});

	it("does NOT open on right-click (button 2)", () => {
		expect(shouldOpenFromActivation(mouse({ button: 2 }))).toBe(false);
	});

	it("opens on keyboard activation — a KeyboardEvent has no .button (I148 regression guard)", () => {
		// Enter on a focused pill: the event carries no `button`. Gating on
		// `button` (the old bug) would reject this and silently swallow Enter-open.
		const enter = { key: "Enter" } as unknown as KeyboardEvent;
		expect(shouldOpenFromActivation(enter)).toBe(true);
		// A real DOM KeyboardEvent (no button) behaves the same.
		expect(
			shouldOpenFromActivation(new KeyboardEvent("keydown", { key: "Enter" })),
		).toBe(true);
	});
});
