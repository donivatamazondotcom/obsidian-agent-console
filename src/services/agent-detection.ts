/**
 * Agent auto-detection (Phase B — first-run default selection).
 *
 * Probes the known built-in agent commands to discover which are actually
 * installed on the machine, and picks a sensible default by priority order.
 * Used once on a true fresh install (no data.json yet) to land the new user
 * on a working agent without touching settings — see plugin.ts
 * `maybeFirstRunOnboarding`.
 *
 * Design constraints (see [[Agent Console Agent Defaults]] § Detection design
 * constraints):
 * - Presence ≠ ACP-capable. Resolving a command proves the binary exists, not
 *   that it speaks a compatible protocol. We do cheap presence-detection only;
 *   connection failures are surfaced later, inline.
 * - The resolver is injected (defaults to the login-shell-aware
 *   `resolveCommandPath`, which inherits the I01 shim-resolution fix) so this
 *   module stays pure and unit-testable without spawning a shell.
 * - Fail-soft: a resolver rejection is treated as "not available" so one bad
 *   probe never sinks detection.
 */

import { resolveCommandPath } from "../utils/paths";

/** A known agent and the command to probe for its presence. */
export interface AgentCandidate {
	/** Agent id (matches the built-in ids in DEFAULT_SETTINGS). */
	id: string;
	/** Bare command name or absolute path to probe. */
	command: string;
}

/**
 * Built-in agent default-selection priority — the first available agent in
 * this order becomes the fresh-install default. Amazon-internal audience leads
 * with kiro-cli; degrades gracefully on machines with only one agent.
 */
export const DEFAULT_AGENT_PRIORITY: readonly string[] = [
	"kiro-cli",
	"claude-code-acp",
	"codex-acp",
	"gemini-cli",
];

/** Resolve a command to an absolute path, or null when not found. */
export type CommandResolver = (command: string) => Promise<string | null>;

/**
 * Probe each candidate's command in parallel and return the set of agent ids
 * whose command resolves to an executable. Blank commands are skipped without
 * calling the resolver; resolver rejections are treated as not-available.
 *
 * @param candidates - Known agents and their commands to probe
 * @param resolve - Command resolver (defaults to the login-shell-aware one)
 * @returns Set of agent ids that resolved
 */
export async function detectAvailableAgents(
	candidates: AgentCandidate[],
	resolve: CommandResolver = resolveCommandPath,
): Promise<Set<string>> {
	const results = await Promise.all(
		candidates.map(async (candidate) => {
			if (!candidate.command || candidate.command.trim().length === 0) {
				return null;
			}
			try {
				const resolved = await resolve(candidate.command);
				return resolved ? candidate.id : null;
			} catch {
				return null;
			}
		}),
	);

	return new Set(
		results.filter((id): id is string => id !== null),
	);
}

/**
 * Pick the first agent id in `priorityOrder` that appears in `availableIds`.
 *
 * @param availableIds - Set of detected agent ids
 * @param priorityOrder - Ordered preference list (defaults to DEFAULT_AGENT_PRIORITY)
 * @returns The first available id by priority, or null when none match
 */
export function pickDefaultAgentId(
	availableIds: Set<string>,
	priorityOrder: readonly string[] = DEFAULT_AGENT_PRIORITY,
): string | null {
	for (const id of priorityOrder) {
		if (availableIds.has(id)) {
			return id;
		}
	}
	return null;
}

/**
 * Phase B rule for the fresh-install default agent: pick the highest-priority
 * detected agent; if none of the known agents resolved, keep the current
 * default (status quo — `claude-code-acp`). Pure so the first-run wiring in
 * plugin.ts stays a one-liner.
 *
 * @param availableIds - Detected agent ids
 * @param currentDefault - The default to keep when nothing resolves
 * @param priorityOrder - Preference list (defaults to DEFAULT_AGENT_PRIORITY)
 * @returns The agent id to use as the fresh-install default
 */
export function chooseFirstRunDefault(
	availableIds: Set<string>,
	currentDefault: string,
	priorityOrder: readonly string[] = DEFAULT_AGENT_PRIORITY,
): string {
	return pickDefaultAgentId(availableIds, priorityOrder) ?? currentDefault;
}
