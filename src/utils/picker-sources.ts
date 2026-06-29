/**
 * Per-source projections into the unified picker view model.
 *
 * Each suggestion source (mention `@`, slash `/`, quick-prompt `!`) maps its
 * domain item into a {@link PickerItem} and declares its footer
 * {@link PickerInstruction}s. Pure functions — no React, no Obsidian — so they
 * unit-test directly and Tier 3 can lift them into `PickerSource` configs
 * unchanged.
 *
 * Spec: [[Unified Picker Control]].
 */
import type { NoteMetadata } from "../services/vault-service";
import type { SlashCommand } from "../types/session";
import type { QuickPrompt } from "../types/quick-prompt";
import type { PickerItem, PickerInstruction } from "../types/picker";
import { MOD_KEY, ALT_KEY, SHIFT_KEY, ENTER_KEY, modCombo } from "./platform";

// ── Item projections ────────────────────────────────────────────────────────

/** `@` mention → row: note name + folder path on one line (native quick-switcher style). */
export function noteToPickerItem(note: NoteMetadata): PickerItem {
	return {
		id: note.path,
		title: note.name,
		subtitle: note.path,
		layout: "inline",
	};
}

/** `/` slash-command → row: `/name` over its description (+ optional hint). */
export function slashCommandToPickerItem(command: SlashCommand): PickerItem {
	const subtitle = command.hint
		? `${command.description} (${command.hint})`
		: command.description;
	return {
		id: `slash-${command.name}`,
		title: `/${command.name}`,
		subtitle,
		layout: "stacked",
	};
}

/** `!` quick-prompt → row: label + new-tab / selection markers. */
export function quickPromptToPickerItem(prompt: QuickPrompt): PickerItem {
	const markers = [];
	if (prompt.newTab) {
		markers.push({ glyph: "↗", label: "opens in a new tab" });
	}
	if (prompt.usesSelection) {
		markers.push({ glyph: "{ }", label: "uses your selected text" });
	}
	return {
		id: prompt.id,
		title: prompt.label,
		layout: "stacked",
		markers: markers.length > 0 ? markers : undefined,
	};
}

// ── Footer instructions ──────────────────────────────────────────────────────

/** `@` mention footer: navigate / add to context / dismiss. */
export const MENTION_INSTRUCTIONS: PickerInstruction[] = [
	{ keys: "↑↓", label: "navigate" },
	{ keys: ENTER_KEY, label: "add to context" },
	{ keys: "esc", label: "dismiss" },
];

/** `/` slash-command footer: navigate / run / dismiss. */
export const SLASH_INSTRUCTIONS: PickerInstruction[] = [
	{ keys: "↑↓", label: "navigate" },
	{ keys: ENTER_KEY, label: "run" },
	{ keys: "esc", label: "dismiss" },
];

/**
 * `!` quick-prompt footer. When the "create" row is selected, only the create
 * hint is relevant; otherwise the full 2×2 gesture set.
 */
export function quickPromptInstructions(
	isCreateSelected: boolean,
): PickerInstruction[] {
	if (isCreateSelected) {
		return [{ keys: ENTER_KEY, label: "create" }];
	}
	return [
		{ keys: ENTER_KEY, label: "run" },
		{ keys: modCombo(MOD_KEY, ENTER_KEY), label: "new tab" },
		{ keys: modCombo(MOD_KEY, SHIFT_KEY, ENTER_KEY), label: "switch" },
		{ keys: modCombo(ALT_KEY, ENTER_KEY), label: "insert" },
	];
}
