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
 * Spec: [[Unified Picker Control]] (Tier 1 — unified view; Tier 2 — ActivePicker).
 */

import type React from "react";

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

// ============================================================================
// Tier 2 — ActivePicker (collapse the InputArea keyboard ladder)
// ============================================================================

/**
 * Which suggestion source a picker represents. Only one is ever open at a time
 * (the trigger characters `@` / `/` / `!` are mutually exclusive at the caret),
 * so `useSuggestions` priority-resolves exactly one into an {@link ActivePicker}.
 */
export type PickerKind = "mention" | "slash" | "quick-prompt";

/** Minimal keyboard-event shape the picker select/key path reads. */
export type PickerKeyEvent = React.KeyboardEvent;

/**
 * Source-declared keyboard rules. These replace the inline per-source branches
 * that used to live in `InputArea.handleDropdownKeyPress`: instead of the
 * handler asking "is this the mention picker? then Shift+Enter dismisses",
 * each source declares its capabilities and the handler reads them generically.
 *
 * Intentionally NOT harmonized: navigation policy (clamp vs wrap) is a per-source
 * behavior owned by each source's `navigate` (mention/slash clamp, quick-prompt
 * wraps around its deterministic bottom create-row) — see the spec's Tier 1
 * smoke decision. It is therefore not a capability flag here.
 */
export interface PickerKeyCapabilities {
	/**
	 * Shift+Enter dismisses the picker WITHOUT selecting, and does not insert a
	 * newline (Obsidian link-autocomplete parity). Mention-only — the slash and
	 * quick-prompt pickers have no native equivalent.
	 */
	dismissOnShiftEnter: boolean;
	/**
	 * The source owns the ⌥ / ⌘ / ⌘⌥ / ⌘⌥⇧ + Enter combos via a pushed Obsidian
	 * `Scope` (QP-I14). When such a combo also bubbles to React, the keyboard
	 * handler swallows it (preventDefault, no select, no send fall-through) so
	 * it neither double-fires nor reaches the send path. Quick-prompt-only.
	 * Plain Enter and ⌘⇧Enter are not scope-owned and select normally.
	 */
	ownsEnterScopeCombos: boolean;
}

/**
 * The single picker currently open in the composer, after `useSuggestions`
 * priority-resolves the three sources (quick-prompt > slash > mention). The
 * `InputArea` keyboard handler routes navigation, dismissal, and selection
 * through this one object instead of a three-way source ladder, reading
 * {@link PickerKeyCapabilities} for the source-specific key rules.
 *
 * `navigate` and `dismiss` are owned by the hook (pure suggestion state).
 * `select` is bound by `InputArea` (the selection side effects — composer text,
 * caret/focus, hint overlay, engine fire — are composer-side concerns the hook
 * does not own); the hook exposes the rest as a {@link ResolvedPicker}.
 *
 * Tier 3 lifts the per-source variance behind this interface into a
 * `PickerSource` so a single `usePicker` state machine replaces the three.
 */
export interface ActivePicker {
	/** Which source this picker represents (for select dispatch + diagnostics). */
	kind: PickerKind;
	/** Always `true` — an `ActivePicker` exists only while its source is open. */
	isOpen: boolean;
	/** Unified rows currently shown (excludes the quick-prompt create row). */
	items: PickerItem[];
	/** Highlighted row index (indexes `items`, or the create row past the end). */
	selectedIndex: number;
	/** Move the highlight. Each source owns its own clamp-vs-wrap policy. */
	navigate(direction: "up" | "down"): void;
	/** Activate the highlighted row (Enter/Tab). Bound by `InputArea`. */
	select(evt: PickerKeyEvent): void;
	/** Escape / Shift+Enter close behavior (mention keeps its run-dismiss guard). */
	dismiss(): void;
	/** Source-declared keyboard rules read generically by the handler. */
	capabilities: PickerKeyCapabilities;
}

/**
 * The hook-owned portion of {@link ActivePicker}: everything `useSuggestions`
 * can resolve on its own. `InputArea` composes the full `ActivePicker` by
 * binding `select` (whose effects are composer-side).
 */
export type ResolvedPicker = Omit<ActivePicker, "select">;
