/**
 * Quick Prompts slice 5 (chip context menu) — pure + port-level units.
 *
 * - S5-T1 `normalizeRenameLabel` (pure): trims; null on empty/whitespace/unchanged.
 * - S5-T2 `renamePromptLabel` (orchestrator + writer port via a fake): writes the
 *   trimmed label on a real change, no-ops otherwise (No-silent-data-loss).
 * - S5-T3 `buildChipMenuItems` (pure): the right-click menu contract — Edit /
 *   Copy / Rename with their lucide icons, in order.
 *
 * The real `VaultQuickPromptWriter.setLabel` (Obsidian `processFrontMatter`), the
 * Edit open-in-new-tab side effect, the clipboard copy, and the `RenamePromptModal`
 * are covered by the human smoke test. See [[Agent Console Quick Prompts UX
 * Refinement]] § Slice 5 — Chip context menu.
 */
import { describe, it, expect, vi } from "vitest";
import {
	normalizeRenameLabel,
	buildChipMenuItems,
} from "../quick-prompts-logic";
import { renamePromptLabel, type QuickPromptWriter } from "../quick-prompts";

describe("quick-prompts-logic — slice 5 (rename label normalization)", () => {
	it("trims surrounding whitespace and returns the new label", () => {
		expect(normalizeRenameLabel("  New name  ", "Old name")).toBe(
			"New name",
		);
	});

	it("returns null for an empty submission", () => {
		expect(normalizeRenameLabel("", "Old name")).toBeNull();
	});

	it("returns null for a whitespace-only submission", () => {
		expect(normalizeRenameLabel("   ", "Old name")).toBeNull();
	});

	it("returns null when the trimmed value equals the current label (no-op)", () => {
		expect(normalizeRenameLabel("Old name", "Old name")).toBeNull();
	});

	it("returns null when only surrounding whitespace differs from current", () => {
		expect(normalizeRenameLabel("  Old name  ", "Old name")).toBeNull();
	});

	it("returns the trimmed value when it differs from the current label", () => {
		expect(normalizeRenameLabel("Brand new", "Old name")).toBe(
			"Brand new",
		);
	});
});

describe("renamePromptLabel — S5-T2 (orchestrator + writer port)", () => {
	function makeFakeWriter() {
		const writer: QuickPromptWriter = {
			listBasenames: () => [],
			create: vi.fn(async () => "x"),
			setLabel: vi.fn(async () => undefined),
		};
		return writer;
	}

	const prompt = { path: "Quick Prompts/Daily brief.md", label: "Daily brief" };

	it("writes the trimmed new label via the writer on a real change", async () => {
		const writer = makeFakeWriter();
		const result = await renamePromptLabel(writer, prompt, "  Morning brief  ");
		expect(result).toEqual({ changed: true, label: "Morning brief" });
		expect(writer.setLabel).toHaveBeenCalledTimes(1);
		expect(writer.setLabel).toHaveBeenCalledWith(
			"Quick Prompts/Daily brief.md",
			"Morning brief",
		);
	});

	it("no-ops on an empty submission (never touches the note)", async () => {
		const writer = makeFakeWriter();
		const result = await renamePromptLabel(writer, prompt, "   ");
		expect(result).toEqual({ changed: false, label: null });
		expect(writer.setLabel).not.toHaveBeenCalled();
	});

	it("no-ops when the label is unchanged", async () => {
		const writer = makeFakeWriter();
		const result = await renamePromptLabel(writer, prompt, "Daily brief");
		expect(result).toEqual({ changed: false, label: null });
		expect(writer.setLabel).not.toHaveBeenCalled();
	});
});

describe("buildChipMenuItems — S5-T3 (right-click menu contract)", () => {
	it("returns Edit / Copy / Rename with their lucide icons, in order", () => {
		expect(buildChipMenuItems()).toEqual([
			{ action: "edit", title: "Edit prompt", icon: "file-pen" },
			{ action: "copy", title: "Copy prompt", icon: "copy" },
			{ action: "rename", title: "Rename", icon: "text-cursor-input" },
		]);
	});
});
