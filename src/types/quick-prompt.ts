/**
 * Types for the Quick Prompts feature — user-defined, vault-stored, reusable
 * prompt triggers. Each prompt is a markdown note in a configurable folder
 * (default `Quick Prompts/`).
 *
 * See [[Agent Console Quick Prompts and Workflows]].
 */

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
	/** Tag scopes for the contextual chips row (slice 2). */
	tags?: string[];
	/** Target agent (later slice). */
	agent?: string;
	/** Target mode (later slice). */
	mode?: string;
	/** Fire into a fresh tab/session (later slice). */
	newTab?: boolean;
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
