/**
 * Pure prompt ↔ note matching.
 *
 * Decides which prompt-library entries to show for the currently active note,
 * based on tags. Kept pure (no Obsidian, no React) for unit-testing; the caller
 * supplies the active note's tags (via Obsidian's `getAllTags`).
 *
 * Rules (per design):
 *  - A prompt with NO tags is global — always shown.
 *  - A prompt with tags shows when the active note carries ANY of them (OR).
 *  - Comparison is case-insensitive and ignores a leading `#`.
 */

import type { PromptDefinition } from "../types/prompt";

/** Normalize a tag for comparison: strip a leading `#`, lowercase, trim. */
function normalizeTag(tag: string): string {
	return tag.trim().replace(/^#+/, "").toLowerCase();
}

/**
 * Does a single prompt apply to a note with the given tags?
 *
 * @param prompt    The prompt definition.
 * @param noteTags  The active note's tags (with or without leading `#`). Pass
 *                  an empty array when no markdown note is active.
 */
export function promptMatchesTags(
	prompt: PromptDefinition,
	noteTags: readonly string[],
): boolean {
	if (prompt.tags.length === 0) return true; // global prompt
	const have = new Set(noteTags.map(normalizeTag));
	return prompt.tags.some((t) => have.has(normalizeTag(t)));
}

/**
 * Filter a prompt library down to the entries applicable to the active note.
 * Order is preserved from the input list.
 */
export function matchingPrompts(
	prompts: readonly PromptDefinition[],
	noteTags: readonly string[],
): PromptDefinition[] {
	return prompts.filter((p) => promptMatchesTags(p, noteTags));
}
