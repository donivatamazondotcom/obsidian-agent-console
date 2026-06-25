/**
 * QuickPromptPickerModal (T16/T17).
 *
 * T16 — lists all prompts; item text is the label (fuzzy filtering is provided
 * by Obsidian's FuzzySuggestModal).
 * T17 — choosing fires by default; ⌥/⇧ + choose inserts (modifier reported to
 * the callback, which routes through the engine).
 *
 * See [[Agent Console Quick Prompts and Workflows]] § Test Cases.
 */
import { describe, it, expect, vi } from "vitest";
import { App } from "obsidian";
import { QuickPromptPickerModal, isInsertModifier } from "../QuickPromptPickerModal";
import type { QuickPrompt } from "../../types/quick-prompt";

const PROMPTS: QuickPrompt[] = [
	{ id: "debrief", label: "🗓️ Debrief meeting", body: "b1", path: "Quick Prompts/Debrief.md", usesSelection: false },
	{ id: "sync-opps", label: "↻ Sync opps", body: "b2", path: "Quick Prompts/Sync.md", usesSelection: false },
	{ id: "summarize", label: "Summarize selection", body: "{{selection}}", path: "Quick Prompts/Sum.md", usesSelection: true },
];

function makeModal(
	onChoose: (prompt: QuickPrompt, opts: { modifier: boolean }) => void,
) {
	return new QuickPromptPickerModal(new App(), PROMPTS, onChoose);
}

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

	// ── T17 ───────────────────────────────────────────────────────────────
	it("T17: plain choose (no modifier) → fire (modifier=false)", () => {
		const onChoose = vi.fn();
		makeModal(onChoose).onChooseItem(PROMPTS[0], { shiftKey: false, altKey: false } as KeyboardEvent);
		expect(onChoose).toHaveBeenCalledWith(PROMPTS[0], { modifier: false });
	});

	it("T17: ⌥ + choose → insert (modifier=true)", () => {
		const onChoose = vi.fn();
		makeModal(onChoose).onChooseItem(PROMPTS[1], { altKey: true, shiftKey: false } as KeyboardEvent);
		expect(onChoose).toHaveBeenCalledWith(PROMPTS[1], { modifier: true });
	});

	it("T17: ⇧ + choose → insert (modifier=true)", () => {
		const onChoose = vi.fn();
		makeModal(onChoose).onChooseItem(PROMPTS[1], { altKey: false, shiftKey: true } as KeyboardEvent);
		expect(onChoose).toHaveBeenCalledWith(PROMPTS[1], { modifier: true });
	});

	it("isInsertModifier: true only when shift or alt is held", () => {
		expect(isInsertModifier(undefined)).toBe(false);
		expect(isInsertModifier({ shiftKey: false, altKey: false } as KeyboardEvent)).toBe(false);
		expect(isInsertModifier({ shiftKey: true, altKey: false } as KeyboardEvent)).toBe(true);
		expect(isInsertModifier({ shiftKey: false, altKey: true } as MouseEvent)).toBe(true);
	});
});
