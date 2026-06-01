/**
 * Context Note Lifecycle — per-chat crystallized context state.
 * See: ACP Context Note Lifecycle spec § State Model, Decision #22.
 */

/** How a note first entered the context strip. Immutable after insertion. */
export type ContextNoteSource = "user" | "mention" | "agent" | "auto-default";

/** Maximum crystallized pills per chat (Decision #9, #16). */
export const MAX_CONTEXT_NOTES = 8;

/**
 * A single crystallized context note.
 * Identity is `path` (vault-relative). Display name derived from basename at render.
 * Array index encodes insertion order (Decision #17).
 */
export interface NoteMetadata {
	/** Vault-relative path; identity key; remapped on vault rename event. */
	path: string;
	/** How this note first entered context. Set once, never mutated. */
	source: ContextNoteSource;
	/** Only consulted when source === 'agent'. False until user opens the note. */
	seen: boolean;
}
