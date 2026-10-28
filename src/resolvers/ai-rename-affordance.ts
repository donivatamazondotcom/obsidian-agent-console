/**
 * Whether "Rename with AI" can run on a tab (I210).
 *
 * Rename with AI asks the tab's agent for a title in a throwaway side session
 * on the live process. An agent that can't close that side session (no
 * session/close — Kiro V2 today) keeps a full MCP set alive for it until the
 * tab closes, so the action is disabled there.
 *
 * One resolver, two consumers: the tab context menu and the command path
 * (via `requestAiTitle`'s `unsupported` result). Pure and total.
 */

export type AiRenameAffordance =
	| { kind: "enabled" }
	| { kind: "disabled"; reason: "in-flight" | "agent-cannot-close" };

export interface AiRenameAffordanceInput {
	/** The tab's agent process has answered initialize (capabilities known). */
	initialized: boolean;
	/** AgentCapabilities.closesSessions for the tab's agent. */
	closesSessions: boolean;
	/** A Rename with AI request is already running for this tab. */
	inFlight: boolean;
}

export function deriveAiRenameAffordance(
	input: AiRenameAffordanceInput,
): AiRenameAffordance {
	if (input.inFlight) return { kind: "disabled", reason: "in-flight" };
	// Before initialize the capabilities are unknown. Stay enabled; the click
	// reports "not ready" through the existing path.
	if (!input.initialized) return { kind: "enabled" };
	return input.closesSessions
		? { kind: "enabled" }
		: { kind: "disabled", reason: "agent-cannot-close" };
}
