/**
 * Vault file metadata — the domain shape for a note in the vault.
 *
 * Lives in types/ (not vault-service) so leaf modules (utils/picker-sources,
 * utils/picker-source-configs) can name it without importing the services
 * layer — utils is a shared leaf and must not depend on services (G2,
 * design-integrity audit). vault-service re-exports it for its existing
 * consumers, whose services-ward imports are legal edges.
 */
export interface NoteMetadata {
	/** Full path to the note within the vault (e.g., "folder/note.md") */
	path: string;

	/** Filename without extension (e.g., "note") */
	name: string;

	/** File extension (usually "md") */
	extension: string;

	/** Creation timestamp (milliseconds since epoch) */
	created: number;

	/** Last modified timestamp (milliseconds since epoch) */
	modified: number;

	/** Optional aliases from frontmatter */
	aliases?: string[];

	/**
	 * Optional text selection range in the editor. Structurally identical to
	 * obsidian's EditorPosition — inlined so types/ keeps its zero-deps tenet
	 * (no obsidian import in this layer).
	 */
	selection?: {
		from: { line: number; ch: number };
		to: { line: number; ch: number };
	};
}
