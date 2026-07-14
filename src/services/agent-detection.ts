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
	"opencode-acp",
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

/**
 * Decide whether the Layer 2 getting-started "dead end" empty state should
 * show for the current chat panel.
 *
 * It shows only when the chat is empty AND the current agent is a **built-in**
 * that detection did not find installed — i.e. a genuine "no working agent"
 * situation for a fresh install. It must NOT show for:
 *  - a chat that already has messages,
 *  - a **custom** agent the user configured deliberately. The guard is the
 *    `builtInIds` membership check below, NOT the detected set: since I171
 *    detection probes custom agents too, a custom id CAN appear in
 *    `detectedIds`, so gating on detection membership alone would be wrong.
 *    Short-circuiting on `!builtInIds.has(currentAgentId)` keeps a custom-agent
 *    default from ever being flagged as a dead end (the I-FRO2 bug), or
 *  - while detection is still pending (`detectedIds === null`).
 *
 * A custom agent with a broken command still surfaces the normal inline
 * connection error, exactly as before onboarding — it is not a dead end the
 * getting-started picks can resolve.
 */
export function shouldShowGettingStarted(params: {
	messageCount: number;
	currentAgentId: string;
	builtInIds: ReadonlySet<string>;
	detectedIds: ReadonlySet<string> | null;
}): boolean {
	const { messageCount, currentAgentId, builtInIds, detectedIds } = params;
	if (messageCount > 0) return false;
	if (detectedIds === null) return false; // detection pending
	if (!builtInIds.has(currentAgentId)) return false; // custom agent → not a dead end
	return !detectedIds.has(currentAgentId); // built-in not detected → dead end
}

/**
 * A session cache for an agent-detection probe that can be **invalidated**.
 *
 * Detection costs a login-shell spawn per agent, so the result is memoized and
 * shared across first-run onboarding and the getting-started empty state. The
 * crucial difference from a plain promise field is `clear()`: when the user
 * fixes a built-in's command in settings (I-FRO5) or an in-plugin install
 * succeeds, the cache must be invalidated so the NEXT `get()` re-probes and the
 * panel clears without a reload. Without `clear()`, a once-empty probe stays
 * empty for the whole session and re-detection silently no-ops.
 *
 * Fail-soft: a probe rejection resolves to an empty set rather than rejecting,
 * so one bad probe never sinks detection (and is not cached as a rejection).
 *
 * @param probe - The (expensive) detection function to memoize
 * @returns A cache with a memoizing `get()` and an invalidating `clear()`
 */
export interface DetectionCache {
	get(): Promise<Set<string>>;
	clear(): void;
}

export function createDetectionCache(
	probe: () => Promise<Set<string>>,
): DetectionCache {
	let cached: Promise<Set<string>> | null = null;
	return {
		get(): Promise<Set<string>> {
			if (!cached) {
				cached = probe().catch(() => new Set<string>());
			}
			return cached;
		},
		clear(): void {
			cached = null;
		},
	};
}

/**
 * Compose detection + priority-selection into the first-run default agent id.
 * Thin, awaitable seam over `chooseFirstRunDefault` so the onboarding wiring
 * (detect → choose) is unit-testable with a mocked detector, without standing
 * up an Obsidian Plugin harness — see plugin.ts `maybeFirstRunOnboarding`.
 *
 * @param detect - Detector yielding the set of installed built-in agent ids
 * @param currentDefault - The default to keep when nothing resolves
 * @param priorityOrder - Preference list (defaults to DEFAULT_AGENT_PRIORITY)
 * @returns The agent id to use as the fresh-install default
 */
export async function resolveFirstRunDefaultAgent(
	detect: () => Promise<Set<string>>,
	currentDefault: string,
	priorityOrder: readonly string[] = DEFAULT_AGENT_PRIORITY,
): Promise<string> {
	return chooseFirstRunDefault(await detect(), currentDefault, priorityOrder);
}
