/**
 * picker-source-configs — the three {@link PickerSource} configurations that
 * drive the one generic `usePicker` state machine (Tier 3).
 *
 * All variance between the composer's `@` / `/` / `!` pickers lives here as
 * pure config: trigger detection, item fetch, row projection, nav policy,
 * select-text rewrite, footer instructions, the mention dismiss guard, and the
 * quick-prompt create row. Each factory takes its runtime dependencies as
 * arguments (vault search, the command list, the prompt library, the fuzzy
 * scorer) so the configs are pure and unit-test directly — no React, no
 * Obsidian. `useSuggestions` builds them from live deps and feeds each to a
 * `usePicker` instance.
 *
 * Spec: [[Unified Picker Control]] (Tier 3 — one picker state machine).
 */
import type { NoteMetadata } from "../services/vault-service";
import type { SlashCommand } from "../types/session";
import type { QuickPrompt } from "../types/quick-prompt";
import type { PickerSource, PickerTriggerContext } from "../types/picker";
import {
	detectMention,
	replaceMention,
	type MentionContext,
} from "./mention-parser";
import {
	detectSlashTrigger,
	filterSlashCommands,
	type SlashTriggerContext,
} from "./slash-command-logic";
import {
	parseQuickPromptTrigger,
	stripQuickPromptTrigger,
	rankLauncherPrompts,
	buildCreatePromptRow,
} from "../services/quick-prompts-logic";
import {
	noteToPickerItem,
	slashCommandToPickerItem,
	quickPromptToPickerItem,
	MENTION_INSTRUCTIONS,
	SLASH_INSTRUCTIONS,
	quickPromptInstructions,
} from "./picker-sources";

// ── Mention `@` ───────────────────────────────────────────────────────────

/**
 * The `@` mention source. `MentionContext` already carries `start` (the `@`
 * index, which the dismiss guard consults), `end`, and `query`. Items come
 * from an async vault search; selection rewrites the `@query` token into the
 * `@[[Note]]` form via `replaceMention`.
 */
export function makeMentionSource(
	searchNotes: (query: string) => Promise<NoteMetadata[]>,
): PickerSource<NoteMetadata, MentionContext> {
	return {
		kind: "mention",
		detectTrigger: (input, caret) => detectMention(input, caret),
		fetchItems: (ctx) => searchNotes(ctx.query),
		toPickerItem: noteToPickerItem,
		navPolicy: "clamp",
		onSelect: (input, ctx, note) =>
			replaceMention(input, ctx, note.name).newText,
		instructions: () => MENTION_INSTRUCTIONS,
		// Esc keeps the dropdown closed for the current @ run (multi-word
		// queries allow spaces, so the run persists in the text).
		dismissGuard: true,
		capabilities: {
			dismissOnShiftEnter: true,
			ownsEnterScopeCombos: false,
		},
	};
}

// ── Slash `/` ───────────────────────────────────────────────────────────────

/**
 * The `/` slash-command source. Triggers only at input start (see
 * `detectSlashTrigger`); items are the available commands filtered by the
 * query; selection replaces the composer with `/<name> ` (the hint-overlay
 * side effect stays in `InputArea`).
 */
export function makeSlashSource(
	availableCommands: SlashCommand[],
): PickerSource<SlashCommand, SlashTriggerContext> {
	return {
		kind: "slash",
		detectTrigger: (input, caret) => detectSlashTrigger(input, caret),
		fetchItems: (ctx) => filterSlashCommands(availableCommands, ctx.query),
		toPickerItem: slashCommandToPickerItem,
		navPolicy: "clamp",
		onSelect: (_input, _ctx, command) => `/${command.name} `,
		instructions: () => SLASH_INSTRUCTIONS,
		capabilities: {
			dismissOnShiftEnter: false,
			ownsEnterScopeCombos: false,
		},
	};
}

// ── Quick-prompt `!` ─────────────────────────────────────────────────────────

/** A fuzzy scorer, matching the injectable shape `rankLauncherPrompts` consumes. */
export type FuzzyScorer = (text: string) => { score: number } | null;

/** Active `!` trigger context — `caret` drives the token strip on select. */
export interface QuickPromptTriggerContext extends PickerTriggerContext {
	/** The query after `!` (spans the rest of the line, including spaces). */
	query: string;
	/** Caret position — where the `!query` token ends (for `stripQuickPromptTrigger`). */
	caret: number;
}

/**
 * The `!` quick-prompt source. Triggers at line start (see
 * `parseQuickPromptTrigger`); items are the prompt library ranked by the
 * injected fuzzy scorer; a create row always sits at the bottom. Selection
 * strips the `!query` token (the engine fires the prompt separately, in
 * `InputArea`). Navigation wraps circularly — it earns the wrap via the
 * deterministic bottom create-row anchor (spec Tier-1 smoke decision).
 */
export function makeQuickPromptSource(
	prompts: QuickPrompt[],
	makeScorer: (query: string) => FuzzyScorer,
): PickerSource<QuickPrompt, QuickPromptTriggerContext> {
	return {
		kind: "quick-prompt",
		detectTrigger: (input, caret) => {
			const query = parseQuickPromptTrigger(input.slice(0, caret));
			if (query === null) return null;
			// The `!` sits one char before the query, which spans to the caret.
			return { start: caret - query.length - 1, query, caret };
		},
		fetchItems: (ctx) => {
			const trimmed = ctx.query.trim();
			const scorer = trimmed ? makeScorer(trimmed) : undefined;
			return rankLauncherPrompts(prompts, ctx.query, scorer);
		},
		toPickerItem: quickPromptToPickerItem,
		navPolicy: "wrap",
		// The `!query` token is stripped; the prompt is fired/staged via the
		// engine in InputArea, so the selected item is irrelevant to the text.
		onSelect: (input, ctx) => stripQuickPromptTrigger(input, ctx.caret),
		instructions: ({ isCreateSelected }) =>
			quickPromptInstructions(isCreateSelected),
		createRow: (ctx, items, input) => {
			// QP-I11: a draft beyond the `!` token becomes the create row's body.
			const draftText = stripQuickPromptTrigger(input, ctx.caret);
			return buildCreatePromptRow(
				ctx.query,
				items.length,
				draftText.trim().length > 0,
			);
		},
		capabilities: {
			dismissOnShiftEnter: false,
			ownsEnterScopeCombos: true,
		},
	};
}
