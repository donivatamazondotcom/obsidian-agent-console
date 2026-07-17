/**
 * picker-sources — pure projections into the unified picker view model.
 * Spec: [[Unified Picker Control]].
 */
import { describe, it, expect } from "vitest";
import type { NoteMetadata } from "../../services/vault-service";
import type { SlashCommand } from "../../types/session";
import type { QuickPrompt } from "../../types/quick-prompt";
import {
	noteToPickerItem,
	slashCommandToPickerItem,
	quickPromptToPickerItem,
	mentionInstructions,
	slashInstructions,
	quickPromptInstructions,
} from "../picker-sources";

function qp(over: Partial<QuickPrompt>): QuickPrompt {
	return {
		id: "x",
		label: "X",
		body: "b",
		path: "Quick Prompts/x.md",
		usesSelection: false,
		...over,
	};
}

describe("noteToPickerItem", () => {
	it("maps name → title, path → subtitle, inline layout", () => {
		const item = noteToPickerItem({
			name: "I147 This vault only filter",
			path: "04-initiatives/Agent Console/I147 This vault only filter.md",
		} as NoteMetadata);
		expect(item).toEqual({
			id: "04-initiatives/Agent Console/I147 This vault only filter.md",
			title: "I147 This vault only filter",
			subtitle:
				"04-initiatives/Agent Console/I147 This vault only filter.md",
			layout: "inline",
		});
	});
});

describe("slashCommandToPickerItem", () => {
	it("maps to /name over description, stacked, slash-prefixed id", () => {
		const item = slashCommandToPickerItem({
			name: "clear",
			description: "Clear the conversation",
		} as SlashCommand);
		expect(item.id).toBe("slash-clear");
		expect(item.title).toBe("/clear");
		expect(item.subtitle).toBe("Clear the conversation");
		expect(item.layout).toBe("stacked");
	});

	it("appends the hint to the subtitle when present", () => {
		const item = slashCommandToPickerItem({
			name: "model",
			description: "Switch model",
			hint: "name",
		} as SlashCommand);
		expect(item.subtitle).toBe("Switch model (name)");
	});
});

describe("quickPromptToPickerItem", () => {
	it("has no markers for a plain prompt", () => {
		expect(quickPromptToPickerItem(qp({})).markers).toBeUndefined();
	});

	it("marks new-tab with ↗", () => {
		const m = quickPromptToPickerItem(qp({ newTab: true })).markers;
		expect(m?.map((x) => x.glyph)).toEqual(["↗"]);
	});

	it("marks selection with { }", () => {
		const m = quickPromptToPickerItem(qp({ usesSelection: true })).markers;
		expect(m?.map((x) => x.glyph)).toEqual(["{ }"]);
	});

	it("carries both markers when both apply", () => {
		const m = quickPromptToPickerItem(
			qp({ newTab: true, usesSelection: true }),
		).markers;
		expect(m?.map((x) => x.glyph)).toEqual(["↗", "{ }"]);
	});
});

describe("instruction sets", () => {
	it("mention + slash footers carry navigate / dismiss labels", () => {
		for (const set of [mentionInstructions(), slashInstructions()]) {
			const labels = set.map((i) => i.label);
			expect(labels).toContain("navigate");
			expect(labels).toContain("dismiss");
			// Every hint has a non-empty key glyph.
			expect(set.every((i) => i.keys.length > 0)).toBe(true);
		}
	});

	it("quick-prompt create-state shows only the create hint", () => {
		const set = quickPromptInstructions(true);
		expect(set).toHaveLength(1);
		expect(set[0].label).toBe("create");
	});

	it("quick-prompt resting state shows the full 2×2 gesture set", () => {
		const labels = quickPromptInstructions(false).map((i) => i.label);
		expect(labels).toEqual(["run", "new tab", "switch", "insert"]);
	});
});
