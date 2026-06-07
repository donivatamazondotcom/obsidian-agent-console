/**
 * I35 — chat panel internal links honor Obsidian modifier/leaf semantics.
 *
 * Exercises the REAL `deriveNewLeaf` helper that both chat render paths
 * (MarkdownRenderer assistant wikilinks, MessageBubble user mentions) call
 * to map a mouse event to a `newLeaf` PaneType. These cases FAIL against the
 * pre-fix code, which never created the helper and passed `""` (→ plain open,
 * modifier discarded) at every call site.
 *
 * `Keymap.isModEvent` is mocked inline to a platform-agnostic contract
 * (mod = metaKey OR ctrlKey) so the matrix is deterministic regardless of the
 * host OS. The helper's own branching — middle-click first, then mod+alt, then
 * mod — is what's under test, not Obsidian's internal isModEvent.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
	Keymap: {
		// Mirror Obsidian's documented core purpose: truthy when the
		// platform mod key (Cmd on macOS, Ctrl elsewhere) is held.
		isModEvent: (evt: MouseEvent) =>
			evt.metaKey || evt.ctrlKey ? "tab" : false,
	},
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
	it("plain left-click → false (honor alwaysOpenInNewTab)", () => {
		expect(deriveNewLeaf(mouse({ button: 0 }))).toBe(false);
	});

	it("Cmd+click (macOS) → new tab", () => {
		expect(deriveNewLeaf(mouse({ button: 0, metaKey: true }))).toBe("tab");
	});

	it("Ctrl+click (Windows/Linux) → new tab", () => {
		expect(deriveNewLeaf(mouse({ button: 0, ctrlKey: true }))).toBe("tab");
	});

	it("Cmd+Alt+click → split pane", () => {
		expect(
			deriveNewLeaf(mouse({ button: 0, metaKey: true, altKey: true })),
		).toBe("split");
	});

	it("Ctrl+Alt+click → split pane", () => {
		expect(
			deriveNewLeaf(mouse({ button: 0, ctrlKey: true, altKey: true })),
		).toBe("split");
	});

	it("middle-click → new tab, regardless of modifiers", () => {
		expect(deriveNewLeaf(mouse({ button: 1 }))).toBe("tab");
		expect(deriveNewLeaf(mouse({ button: 1, metaKey: true }))).toBe("tab");
		expect(
			deriveNewLeaf(mouse({ button: 1, metaKey: true, altKey: true })),
		).toBe("tab");
	});

	it("Alt+click without mod → false (alt alone is not a leaf modifier)", () => {
		expect(deriveNewLeaf(mouse({ button: 0, altKey: true }))).toBe(false);
	});

	it("right-click (button 2) → false (handled by caller's guard, not a leaf)", () => {
		expect(deriveNewLeaf(mouse({ button: 2 }))).toBe(false);
	});
});
