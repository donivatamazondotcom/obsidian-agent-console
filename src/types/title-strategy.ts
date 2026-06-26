/**
 * Session title generation strategy (F03 — AI Session Rename).
 *
 * Governs how a tab's label is produced for a new session:
 * - `agent-suggested` (default): inject a title rubric on the first message
 *   and parse a `<title>…</title>` marker from the head of the agent's reply.
 *   Falls back to the prompt-derived truncation as the interim label.
 * - `prompt-derived`: the pre-F03 behavior — first-message truncation via
 *   deriveTabLabel. No rubric, no marker parsing.
 * - `agent-timestamp`: never derive a label; keep the agent-name + timestamp
 *   default a new tab starts with.
 *
 * Lives in its own module (no other imports) so plugin.ts, the settings
 * normalizer, SettingsTab, and message-sender can all reference it without
 * creating a circular dependency through plugin.ts.
 *
 * See [[ACP AI Session Rename]].
 */
export type TitleStrategy =
	| "agent-suggested"
	| "prompt-derived"
	| "agent-timestamp";

/**
 * Default out-of-box strategy (Decision D1, ratified 2026-06-25).
 *
 * Both new installs (empty data.json) and upgrades (data.json without a
 * `titleStrategy` key) land here — the normalizer's enum fallback covers
 * both, so there is no separate upgrade-migration branch.
 */
export const DEFAULT_TITLE_STRATEGY: TitleStrategy = "agent-suggested";

/** Valid strategy values, used for enum normalization of persisted settings. */
export const TITLE_STRATEGY_VALUES: TitleStrategy[] = [
	"agent-suggested",
	"prompt-derived",
	"agent-timestamp",
];

/** Dropdown options (sentence-case labels) for the settings UI. */
export const TITLE_STRATEGY_OPTIONS: ReadonlyArray<{
	value: TitleStrategy;
	label: string;
}> = [
	{
		value: "agent-suggested",
		label: "Suggested by the agent in its first reply",
	},
	{ value: "prompt-derived", label: "Generated from your first message" },
	{ value: "agent-timestamp", label: "Agent name and timestamp" },
];
