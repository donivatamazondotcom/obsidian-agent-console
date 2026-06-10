/**
 * Pure decision helpers for agent switching on a tab.
 *
 * Extracted as pure functions (no React, no Obsidian) so the agent-switch
 * decision and the lazy-acquisition agent selection are unit-testable in
 * isolation — the seam behind the "switch agent on a new tab, then type,
 * connects to the OLD agent" bug.
 *
 * This is the stopgap slice of the larger
 * [[Tab Agent Identity and Session Acquisition Unification]] design: the lazy
 * state machine should be the single owner of session acquisition, and the
 * tab's current agent the single source of truth the acquisition reads.
 */

export type AgentSwitchDecision =
	/** Requested agent equals the current agent — nothing to do. */
	| { kind: "noop" }
	/**
	 * Idle, no-session, no-message tab: swap the tab's agent in place WITHOUT
	 * creating a session. The lazy path acquires the (now-updated) agent on
	 * first send. Avoids the eager createSession that desyncs the lazy state
	 * machine and clobbers the switch.
	 */
	| { kind: "swap-idle" }
	/**
	 * Tab has an active session or messages: a genuine teardown + recreate is
	 * the right semantics (this is "new chat with a different agent").
	 */
	| { kind: "recreate" };

export interface DecideAgentSwitchParams {
	/** Agent the user picked in the switch menu. */
	requestedAgentId: string;
	/** Agent the tab is currently bound to (session.agentId). */
	currentAgentId: string;
	/** Whether an ACP session already exists for this tab (sessionId != null). */
	hasSession: boolean;
	/** Number of messages already in the tab. */
	messageCount: number;
}

/**
 * Decide how to handle an agent switch on a tab.
 *
 * - same agent              → noop
 * - different, idle+empty   → swap-idle (no eager session)
 * - different, has session  → recreate
 * - different, has messages → recreate
 */
export function decideAgentSwitch(
	params: DecideAgentSwitchParams,
): AgentSwitchDecision {
	const { requestedAgentId, currentAgentId, hasSession, messageCount } =
		params;

	if (requestedAgentId === currentAgentId) {
		return { kind: "noop" };
	}
	if (!hasSession && messageCount === 0) {
		return { kind: "swap-idle" };
	}
	return { kind: "recreate" };
}

/**
 * Choose which agent the lazy session-acquisition path should connect to.
 *
 * The live session agent (updated by a switch) wins over the mount-time
 * fallback (`config?.agent || initialAgentId`). Reading the mount-time prop
 * alone was the clobber: after switching to Claude Code, acquisition still
 * used the original default agent.
 */
export function selectAcquisitionAgent(
	sessionAgentId: string | null | undefined,
	fallbackAgentId: string | null | undefined,
): string | undefined {
	return sessionAgentId || fallbackAgentId || undefined;
}
