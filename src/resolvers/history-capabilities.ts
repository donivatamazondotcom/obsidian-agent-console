/**
 * `resolveHistoryCapabilities` — which capability record the Session history
 * view gates on, and how sure it is (I260).
 *
 * Before `initialize` a tab has no capabilities. Reading that as "can't list
 * sessions" disabled the Agent pill on a disconnected Claude Code tab and
 * showed a false "doesn't keep a session list" tooltip, breaking Session
 * History Source Model Decision 1 (a disconnected tab shows the last-synced
 * Agent list) and the Connection-free reading tenet.
 *
 * Order: the live record from this tab's `initialize` wins; else the record
 * this launch reported at its last `initialize` (cached by launch key, never
 * by agent id); else `unknown`. Only the history view reads this. Agent calls
 * (restore, load, resume) keep gating on the live record.
 *
 * Pure and total.
 */
import { NO_AGENT_CAPABILITIES } from "../types/session";
import type { AgentCapabilities } from "../types/session";

/** How the history view knows the agent's capabilities. */
export type CapabilityKnowledge =
	/** From this tab's own `initialize`. */
	| "live"
	/** From this launch's last `initialize`, before this tab connected. */
	| "cached"
	/** Never seen for this launch: nothing can be said yet. */
	| "unknown";

export interface HistoryCapabilities {
	kind: CapabilityKnowledge;
	capabilities: AgentCapabilities;
}

export function resolveHistoryCapabilities(
	live: AgentCapabilities | undefined,
	cached: AgentCapabilities | undefined,
): HistoryCapabilities {
	if (live) return { kind: "live", capabilities: live };
	if (cached) return { kind: "cached", capabilities: cached };
	return { kind: "unknown", capabilities: NO_AGENT_CAPABILITIES };
}
