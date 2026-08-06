/**
 * Types for the Quick Prompts feature — user-defined, vault-stored, reusable
 * prompt triggers. Each prompt is a markdown note in a configurable folder
 * (default `Quick Prompts/`).
 *
 * See [[Agent Console Quick Prompts and Workflows]].
 */

/**
 * A parsed `show when:` condition.
 *
 * Tagged union so an existence condition cannot carry a phantom value:
 *
 * - `exists` — a **bare** item (no `=`), e.g. `- source-url`. Matches any
 *   note that HAS the property with a non-empty value, whatever that value is.
 *   The `tags` key means "the note has at least one tag".
 * - `equals` — a `key=value` item. Equality / list-membership against the
 *   note's frontmatter; the `tags` key routes to nested tag matching.
 */
export type ShowWhenCondition =
	| {
			kind: "exists";
			/** Frontmatter property name — or `tags` for "has any tag". */
			key: string;
	  }
	| {
			kind: "equals";
			/** Frontmatter property name — or `tags` to match the note's tags. */
			key: string;
			/** Value to match (equality / list-membership; tag scope for `tags`). */
			value: string;
	  };

/**
 * A parsed quick prompt, ready to surface in the picker / chips and fire.
 *
 * `id` is derived from the filename slug and is **stable across re-scans**
 * (design constraint: per-prompt hotkeys are keyed by command id, so the id
 * must survive a folder re-scan — never index-based).
 */
export interface QuickPrompt {
	/** Stable, filename-derived slug id (e.g. `debrief-meeting`). */
	id: string;
	/** Button / palette label. `description` → `name` → `title` → basename. */
	label: string;
	/** Prompt text (note body with frontmatter stripped). */
	body: string;
	/** Vault-relative path of the source note. */
	path: string;
	/** True when `body` references the `{{selection}}` placeholder. */
	usesSelection: boolean;
	// ── Parsed-and-carried (inert in the core slice; consumed by later slices) ──
	/**
	 * Contextual-chip scope: conditions parsed from the `show when:` List
	 * property. Each item is either `key=value` (equality / list-membership) or
	 * a **bare** `key` (existence — the note has that property at all). The chip
	 * shows when ALL conditions match the active note (AND), or when
	 * `alwaysShow` is true. Empty/absent ⇒ search-only. The `tags` key routes to
	 * tag matching (nested, `#`-tolerant) for an `equals` condition, or
	 * "has any tag" for an `exists` one.
	 */
	showWhen?: ShowWhenCondition[];
	/**
	 * Global chip (slice 2): show in the resting row on every note, regardless
	 * of tags. Frontmatter key `always show` (boolean checkbox).
	 */
	alwaysShow?: boolean;
	/**
	 * How the `showWhen` conditions combine. Frontmatter key `show when any`
	 * (boolean checkbox, seeded directly beneath `show when` so the pairing is
	 * visible in the Properties panel). Absent/false ⇒ ALL conditions must
	 * match (AND — the default); true ⇒ ANY one is enough (OR). Never widens an
	 * empty condition list: no conditions still means search-only.
	 */
	matchAny?: boolean;
	/** Target agent (later slice). */
	agent?: string;
	/** Target mode (later slice). */
	mode?: string;
	/** Fire into a fresh tab/session (later slice). */
	newTab?: boolean;
	/**
	 * Resting-row / launcher sort key. Lower sorts first (`order: 0`
	 * leftmost). Absent/non-numeric ⇒ sorts after all numeric-`order`
	 * prompts, alphabetically by label. Parsed with `Number.isFinite`
	 * so `0` is kept.
	 */
	order?: number;
}

/**
 * Raw file input to the pure builder. Frontmatter is already parsed by the
 * caller (the real adapter reads it from Obsidian's metadata cache; tests pass
 * a plain object), so the pure logic never hand-rolls YAML.
 */
export interface QuickPromptFileInput {
	/** Vault-relative path. */
	path: string;
	/** Filename without extension. */
	basename: string;
	/** Parsed frontmatter, or null when the note has none. */
	frontmatter: Record<string, unknown> | null;
	/** Note body with the frontmatter block stripped. */
	body: string;
}

/**
 * The browser-true 2x2 activation axes for a quick-prompt gesture.
 * Moved here from services/quick-prompts-logic (utils-leaf refactor, G2) so
 * utils/quick-prompt-gesture — a leaf — can name it without a services edge.
 */
export interface QuickPromptGesture {
	/** ⌘/⌃/middle-click — open in a new tab. */
	openElsewhere: boolean;
	/** ⇧ — when opening a new tab, switch to it (foreground). */
	foreground: boolean;
	/** ⌥ — insert/stage instead of send. */
	insert: boolean;
}
