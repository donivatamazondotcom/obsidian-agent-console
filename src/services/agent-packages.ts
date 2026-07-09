/**
 * Built-in agent install metadata — the single source of truth for which
 * built-in agents have a one-line npm install, their docs setup-guide slug,
 * and how the install command is spelled.
 *
 * Used by:
 *  - the settings tab install hints (`SettingsTab.addInstallHint`), and
 *  - the first-run getting-started empty state (`MessageList.GettingStarted`),
 *
 * so the package strings and the `npm install -g …@latest` form live in ONE
 * place. Kiro has no npm package (it ships through its own installer), so its
 * `npmPackage` is null — the empty state shows a setup-guide link, not an
 * Install button.
 */

/** Base URL for the docs-site agent setup guides (one page per agent slug). */
export const DOCS_AGENT_SETUP_BASE =
	"https://donivatamazondotcom.github.io/obsidian-agent-console/agent-setup";

export interface BuiltInAgentInstall {
	/** Built-in agent id (matches the ids in DEFAULT_SETTINGS). */
	id: string;
	/** Human-readable name shown in the UI. */
	displayName: string;
	/** Docs setup-guide page slug (`<DOCS_AGENT_SETUP_BASE>/<slug>`). */
	docsSlug: string;
	/** npm package for the one-line install, or null when there isn't one. */
	npmPackage: string | null;
}

/**
 * The built-in agents, in first-run presentation order. `npmPackage` null ⇒
 * link-only (no Install button). Keep ids in sync with DEFAULT_SETTINGS and
 * the detection priority in `agent-detection.ts`.
 */
export const BUILTIN_AGENT_INSTALLS: readonly BuiltInAgentInstall[] = [
	{
		id: "claude-code-acp",
		displayName: "Claude Code",
		docsSlug: "claude-code",
		npmPackage: "@agentclientprotocol/claude-agent-acp",
	},
	{
		id: "codex-acp",
		displayName: "Codex",
		docsSlug: "codex",
		npmPackage: "@zed-industries/codex-acp",
	},
	{
		id: "gemini-cli",
		displayName: "Gemini CLI",
		docsSlug: "gemini-cli",
		npmPackage: "@google/gemini-cli",
	},
	{
		id: "kiro-cli",
		displayName: "Kiro CLI",
		docsSlug: "kiro-cli",
		npmPackage: null,
	},
	{
		id: "opencode-acp",
		displayName: "OpenCode",
		docsSlug: "opencode",
		npmPackage: null,
	},
];

/** The one-line global install command for an npm package. */
export function buildInstallCommand(npmPackage: string): string {
	return `npm install -g ${npmPackage}@latest`;
}

/** The docs setup-guide URL for an agent slug. */
export function docsSetupUrl(docsSlug: string): string {
	return `${DOCS_AGENT_SETUP_BASE}/${docsSlug}`;
}
