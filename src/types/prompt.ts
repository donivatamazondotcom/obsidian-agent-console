/**
 * Types for the Agent Console **prompt library**.
 *
 * A prompt is a markdown file in a user-designated vault folder (configured via
 * `promptLibraryFolder`). Its YAML frontmatter declares how to launch it and
 * which notes it applies to; the markdown body is the prompt text sent to the
 * agent. Format is inspired by prompty.ai but is our own minimal schema — no
 * templating, no role parsing.
 *
 * Example file:
 *
 *   ---
 *   name: daily briefing
 *   description: "🗓️ Start daily brief."
 *   agent: kiro-cli              # Agent Console agent id (the tool/profile)
 *   model: claude-sonnet-4.6    # optional — model id
 *   mode: my-personal-va        # optional — ACP session mode (e.g. a Kiro persona)
 *   tags: [dailyNote]           # optional — show only on notes carrying any of these tags
 *   ---
 *
 *   Create my daily briefing and sync today's meetings from my calendar.
 *
 * Buttons render inside the chat panel (not in notes), and clicking one pins
 * the active note into context and sends the prompt. See
 * `services/prompt-library.ts` and `hooks/useMatchingPrompts.ts`.
 */

/**
 * A fully-parsed, validated prompt definition. All optional frontmatter fields
 * are normalized here so the launch path never re-derives them.
 */
export interface PromptDefinition {
	/** Vault-relative path of the source prompt file. Identity key. */
	path: string;
	/** Short name (frontmatter `name`); used as a fallback button label. */
	name: string;
	/** Button label (frontmatter `description`). Falls back to `name`. */
	description: string;
	/** Prompt text sent to the agent (the markdown body). Required, non-empty. */
	prompt: string;
	/** Agent Console agent id — the tool/profile to run. Required. */
	agent: string;
	/** Model id to select before sending. Undefined → agent default. */
	model?: string;
	/**
	 * ACP session mode to select before sending — e.g. a tool-internal
	 * agent/persona such as a Kiro `my-personal-va`. Undefined → agent default.
	 */
	mode?: string;
	/**
	 * Tags this prompt applies to. A prompt shows when the active note carries
	 * ANY of these tags (OR match). An empty array means the prompt is global
	 * (always shown). Tags are stored without the leading `#`.
	 */
	tags: string[];
}

/**
 * Result of parsing one prompt file. On success `prompt` holds the normalized
 * definition; on failure `errors` lists every problem (so the settings UI /
 * logs can report all issues at once). A file that fails to parse is simply
 * omitted from the library — it never throws.
 */
export type PromptParseResult =
	| { ok: true; prompt: PromptDefinition }
	| { ok: false; errors: string[] };
