/**
 * QuickPromptPickerModal (T16/T17 + slice-1 2×2).
 *
 * T16 — lists all prompts; item text is the label (fuzzy filtering is provided
 * by Obsidian's FuzzySuggestModal).
 * T17 — choosing reports the browser-true 2×2 gesture to the callback, which
 * routes through the engine: plain → fire, ⌘ → new tab, ⇧ → foreground,
 * ⌥ → insert.
 *
 * See [[Agent Console Quick Prompts UX Refinement]] § The action model.
 */
import { describe, it, expect, vi } from "vitest";
import { App } from "obsidian";
import { QuickPromptPickerModal } from "../QuickPromptPickerModal";
import type { QuickPrompt } from "../../types/quick-prompt";
import type { QuickPromptGesture } from "../../services/quick-prompts-logic";

const PROMPTS: QuickPrompt[] = [
	{ id: "debrief", label: "🗓️ Debrief meeting", body: "b1", path: "Quick Prompts/Debrief.md", usesSelection: false },
	{ id: "sync-opps", label: "↻ Sync opps", body: "b2", path: "Quick Prompts/Sync.md", usesSelection: false },
	{ id: "summarize", label: "Summarize selection", body: "{{selection}}", path: "Quick Prompts/Sum.md", usesSelection: true },
];

function makeModal(
	onChoose: (prompt: QuickPrompt, gesture: QuickPromptGesture) => void,
) {
	return new QuickPromptPickerModal(new App(), PROMPTS, onChoose);
}

const PLAIN = { openElsewhere: false, foreground: false, insert: false };

describe("QuickPromptPickerModal", () => {
	// ── T16 ───────────────────────────────────────────────────────────────
	it("T16: lists all prompts", () => {
		expect(makeModal(vi.fn()).getItems()).toEqual(PROMPTS);
	});

	it("T16: item text is the prompt label", () => {
		const modal = makeModal(vi.fn());
		expect(modal.getItemText(PROMPTS[0])).toBe("🗓️ Debrief meeting");
		expect(modal.getItemText(PROMPTS[2])).toBe("Summarize selection");
	});

	// ── T17 — 2×2 gesture mapping ───────────────────────────────────────────
	it("plain choose → fire gesture (all axes false)", () => {
		const onChoose = vi.fn();
		makeModal(onChoose).onChooseItem(PROMPTS[0], {} as KeyboardEvent);
		expect(onChoose).toHaveBeenCalledWith(PROMPTS[0], PLAIN);
	});

	it("⌥ + choose → insert", () => {
		const onChoose = vi.fn();
		makeModal(onChoose).onChooseItem(PROMPTS[1], { altKey: true } as KeyboardEvent);
		expect(onChoose).toHaveBeenCalledWith(PROMPTS[1], { ...PLAIN, insert: true });
	});

	it("⇧ + choose → foreground (NOT insert — ⇧ is the focus modifier now)", () => {
		const onChoose = vi.fn();
		makeModal(onChoose).onChooseItem(PROMPTS[1], { shiftKey: true } as KeyboardEvent);
		expect(onChoose).toHaveBeenCalledWith(PROMPTS[1], { ...PLAIN, foreground: true });
	});

	it("⌘ + choose → openElsewhere (new tab)", () => {
		const onChoose = vi.fn();
		makeModal(onChoose).onChooseItem(PROMPTS[0], { metaKey: true } as KeyboardEvent);
		expect(onChoose).toHaveBeenCalledWith(PROMPTS[0], { ...PLAIN, openElsewhere: true });
	});

	it("⌘⇧ + choose → openElsewhere + foreground (new tab, switch)", () => {
		const onChoose = vi.fn();
		makeModal(onChoose).onChooseItem(PROMPTS[0], { metaKey: true, shiftKey: true } as KeyboardEvent);
		expect(onChoose).toHaveBeenCalledWith(PROMPTS[0], {
			openElsewhere: true,
			foreground: true,
			insert: false,
		});
	});
});
