/**
 * The one hand-written list of built-in agents (I313).
 *
 * Every place that needs "all built-ins" — the agent pickers, settings
 * lookup, the custom-id uniqueness check, the normalizer's default-agent
 * check, ChatPanel's getting-started check and detection-cache key — derives
 * from {@link builtInAgentSettings}. Before this, each kept its own list and
 * a new built-in (OpenCode, #218) reached only some of them.
 *
 * Type-only imports keep this a leaf module, so the settings normalizer can
 * use it without an import cycle (session-helpers imports the normalizer).
 * Order is presentation order.
 */
import type { AgentClientPluginSettings } from "../plugin";
import type { BaseAgentSettings } from "../types/agent";

/** Settings keys of the built-in agents, in presentation order. */
export const BUILT_IN_AGENT_KEYS = [
	"claude",
	"codex",
	"gemini",
	"kiro",
	"opencode",
	"antigravity",
] as const;

export type BuiltInAgentKey = (typeof BUILT_IN_AGENT_KEYS)[number];

/** Every built-in agent's settings, in presentation order. */
export function builtInAgentSettings(
	settings: Pick<AgentClientPluginSettings, BuiltInAgentKey>,
): BaseAgentSettings[] {
	return BUILT_IN_AGENT_KEYS.map((key) => settings[key]);
}

/** Every built-in agent's id, in presentation order. */
export function builtInAgentIds(
	settings: Pick<AgentClientPluginSettings, BuiltInAgentKey>,
): string[] {
	return builtInAgentSettings(settings).map((agent) => agent.id);
}

/**
 * Every built-in's command, joined. ChatPanel resets agent detection when
 * this changes, so fixing a built-in's path clears a stale "not installed"
 * result (I-FRO5).
 */
export function builtInAgentCommandsKey(
	settings: Pick<AgentClientPluginSettings, BuiltInAgentKey>,
): string {
	return builtInAgentSettings(settings)
		.map((agent) => agent.command)
		.join("\u0000");
}
