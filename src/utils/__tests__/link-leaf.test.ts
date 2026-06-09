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

import { deriveNewLeaf } from "../link-leaf";

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
