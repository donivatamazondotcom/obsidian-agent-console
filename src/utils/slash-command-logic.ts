/**
 * slash-command-logic — pure trigger detection + filtering for the `/`
 * slash-command picker. Zero React, zero Obsidian, so the load-bearing
 * decisions (when the `/` trigger is active, which commands match) unit-test
 * directly — the same pattern as `mention-parser` and `quick-prompts-logic`.
 *
 * Extracted from the inline logic that used to live in `useSuggestions` so the
 * `PickerSource` config can consume it (Tier 3 — one picker state machine).
 *
 * Spec: [[Unified Picker Control]].
 */
import type { SlashCommand } from "../types/session";

/** Active `/` trigger context. `start` is always 0 — slash fires only at input start. */
export interface SlashTriggerContext {
	/** Index of the `/` (always 0 — slash triggers only at the very start). */
	start: number;
	/** Lowercased query after the `/` (empty string for a bare `/`). */
	query: string;
}

/**
 * Detect the `/` slash-command trigger from the text up to the caret.
 *
 * Slash commands trigger ONLY when the input begins with `/` (start of the
 * composer, not mid-line). Once a space follows the command name the command
 * is considered complete and the user is typing arguments, so the trigger
 * deactivates. The query is everything after `/` up to the caret, lowercased
 * (case-insensitive matching). A bare `/` yields an empty query (show all).
 *
 * Returns `null` when no trigger is active.
 */
export function detectSlashTrigger(
	input: string,
	caret: number,
): SlashTriggerContext | null {
	// Slash commands only trigger at the very beginning of input.
	if (!input.startsWith("/")) return null;

	// Query is the text after `/` up to the caret.
	const afterSlash = input.slice(0, caret).slice(1);

	// A space means the command is complete and the user is typing arguments.
	if (afterSlash.includes(" ")) return null;

	return { start: 0, query: afterSlash.toLowerCase() };
}

/**
 * Filter the available slash commands by a (already-lowercased) query — a
 * case-insensitive substring match on the command name. An empty query matches
 * every command (show all).
 */
export function filterSlashCommands(
	commands: SlashCommand[],
	query: string,
): SlashCommand[] {
	const q = query.toLowerCase();
	return commands.filter((cmd) => cmd.name.toLowerCase().includes(q));
}
