/**
 * Pluggable import-source adapters for one-time settings migration from
 * another Obsidian agent-connecting plugin. See [[Agent Console Settings
 * Migration]].
 *
 * v1.2.0 ships one source — "agent-client" (the upstream RAIT-09 plugin this
 * fork derives from). The interface keeps additional sources cheap to add (D5).
 */
import type { AgentClientPluginSettings } from "../../plugin";

/** Per-agent summary shown in the import preview dialog. */
export interface ImportAgentPreview {
	/** Built-in agent slot this row describes. */
	key: "claude" | "codex" | "gemini";
	displayName: string;
	command: string;
	/**
	 * What happens to this agent's API key on import:
	 * - "none": source has no key for this agent.
	 * - "by-reference": source apiKeySecretId resolves in this vault's shared
	 *   secret store; ports with no re-link.
	 * - "needs-relink": source references a secret id absent from this vault;
	 *   the user must re-link the key after import.
	 * - "will-migrate-plaintext": source has a legacy plaintext apiKey; it is
	 *   migrated into secretStorage on apply().
	 */
	keyStatus:
		| "none"
		| "by-reference"
		| "needs-relink"
		| "will-migrate-plaintext";
}

/** Result of inspecting a source plugin's config without mutating anything. */
export interface ImportPreview {
	sourceId: string;
	sourceDisplayName: string;
	agents: ImportAgentPreview[];
	customAgentCount: number;
	defaultAgentId: string;
	/**
	 * Raw source settings. apply() re-normalizes this with the real key
	 * migrator; kept on the preview so the dialog stays a pure inspection.
	 */
	raw: Record<string, unknown>;
}

/**
 * A migration source. Reads another plugin's stored config and produces an
 * importable agent-config slice.
 */
export interface ImportSource {
	/** Stable id, e.g. "agent-client". */
	id: string;
	/** Human-readable name, e.g. "Agent Client". */
	displayName: string;
	/** True if the source's config is present and parseable. */
	detect(): Promise<boolean>;
	/** Inspect the source config; null if not detectable. Side-effect free. */
	preview(): Promise<ImportPreview | null>;
	/**
	 * Produce the importable agent-config slice, applying any required secret
	 * migration. Fork-only fields (kiro, tab/session state, etc.) are
	 * intentionally omitted so the caller's `{ ...current, ...slice }` merge
	 * preserves the user's existing Agent Console state. The caller saves.
	 */
	apply(preview: ImportPreview): Promise<Partial<AgentClientPluginSettings>>;
}
