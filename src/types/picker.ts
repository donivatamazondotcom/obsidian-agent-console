/**
 * Unified picker view model.
 *
 * The composer's suggestion popup (`@` mentions, `/` slash-commands, `!`
 * quick-prompts) renders one shape: a list of {@link PickerItem} rows plus an
 * optional pinned {@link PickerInstruction} footer. Each call site projects its
 * own domain items into `PickerItem`s and supplies its own instruction set, so
 * the control hardcodes neither the row layout nor the help text — that
 * variance is the caller's (Tier 3 will lift it into a `PickerSource`).
 *
 * Spec: [[Unified Picker Control]] (Tier 1 — unified view).
 */

/** How a row lays out its title and subtitle. */
export type PickerLayout = "inline" | "stacked";

/** A small glyph shown inline after a row's title (e.g. ↗ new tab, { } selection). */
export interface PickerMarker {
	/** The glyph to render, e.g. "↗" or "{ }". */
	glyph: string;
	/** Accessible label describing what the marker means. */
	label: string;
}

/** One row in the picker. Domain-agnostic — callers map their items into this. */
export interface PickerItem {
	/** Stable key for React + selection (note path, slash `slash-<name>`, prompt id). */
	id: string;
	/** Primary text (note name, `/command`, prompt label). */
	title: string;
	/** Secondary text (folder path, command description). Omit for none. */
	subtitle?: string;
	/** Inline markers shown after the title. */
	markers?: PickerMarker[];
	/** `inline` = title + subtitle on one row; `stacked` = subtitle below. Default `stacked`. */
	layout?: PickerLayout;
}

/** One hint row in the pinned footer, e.g. `{ keys: "↵", label: "add to context" }`. */
export interface PickerInstruction {
	/** Key hint — a glyph/word or a platform-resolved combo (via `utils/platform`). */
	keys: string;
	/** Plain-language action label. */
	label: string;
}

/**
 * Optional "create" affordance appended after the items (quick-prompt only).
 * Structural — any object with a `label` satisfies it (the quick-prompt
 * `CreatePromptRow` does).
 */
export interface PickerCreateRow {
	/** Row label, e.g. `Create quick prompt "daily"`. */
	label: string;
}
