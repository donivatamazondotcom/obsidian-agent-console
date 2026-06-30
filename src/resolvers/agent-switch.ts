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

// ============================================================================
// decideSessionIntent — the unified pure decision for the
// "useLazySession is the sole owner of session/new" refactor
// ([[Tab Agent Identity and Session Acquisition Unification]] design item #1).
//
// Every "create / recreate / restart / reload a session" entry point in the
// UI (switch agent, new chat, new chat in directory, restart agent, hard/soft
// reload) maps to ONE of these intents. The decision says what should happen
// to (a) the tab's agent binding, (b) the live session, and (c) the lazy
// state machine — WITHOUT any handler calling `agent.createSession` directly.
// The caller (ChatPanel) executes the decision and lets the lazy path acquire
// the (correct) agent on the next send.
// ============================================================================

/** The user/UI action being applied to a tab. */
export type SessionIntent =
	/** User picked a (possibly different) agent from the switch menu. */
	| "switch-agent"
	/** "New chat" — clear the transcript, same agent, defer re-acquire. */
	| "new-chat"
	/** "New chat in directory…" — same agent, new cwd, defer re-acquire. */
	| "new-chat-in-directory"
	/** "Restart agent" — respawn the subprocess (disconnect), same agent. */
	| "restart-agent"
	/** Hard reload — fresh session under a fresh harness, transcript cleared. */
	| "hard-reload"
	/** Soft reload — resume the SAME session under a fresh harness (loadSession). */
	| "soft-reload";

export type SessionIntentDecision =
	/** Nothing to do (e.g. switch to the same agent, or "new chat" on an
	 *  already-empty idle tab, or soft-reload with no live session). */
	| { kind: "noop" }
	/** Idle, no-session, no-message tab: swap the agent binding in place,
	 *  create NO session. The lazy path acquires `agentId` on first send. */
	| { kind: "swap-idle"; agentId: string }
	/** Clear the transcript + reset the lazy machine to idle + defer
	 *  acquisition to first send. No subprocess respawn. `agentId` is the
	 *  agent the next acquisition must bind to. */
	| { kind: "recreate-lazy"; agentId: string }
	/** Disconnect the subprocess (genuine respawn) + reset the lazy machine
	 *  + defer acquisition. Used by Restart agent / hard reload. */
	| { kind: "respawn-lazy"; agentId: string }
	/** Resume the SAME live session (soft reload — loadSession, not
	 *  session/new). Transcript preserved; not part of the new-session owner. */
	| { kind: "resume" };

export interface DecideSessionIntentParams {
	/** Which UI action is being applied. */
	intent: SessionIntent;
	/** Agent the tab is currently bound to (the source of truth, TabInfo.agentId). */
	currentAgentId: string;
	/**
	 * Agent the user picked, when the intent carries one (switch-agent, or a
	 * new-chat invoked with an explicit agent). Undefined → keep current.
	 */
	requestedAgentId?: string;
	/** Whether an ACP session already exists for this tab (sessionId != null). */
	hasSession: boolean;
	/** Number of messages already in the tab. */
	messageCount: number;
}

/**
 * Resolve a UI action against the tab's current state into a single,
 * exhaustively-testable decision. Total function — every input maps to a
 * known `kind`; never throws.
 *
 * The returned `agentId` (when present) is always the agent the next
 * acquisition must bind to, so the caller never has to recompute it.
 */
export function decideSessionIntent(
	params: DecideSessionIntentParams,
): SessionIntentDecision {
	const { intent, currentAgentId, requestedAgentId, hasSession, messageCount } =
		params;

	const targetAgent = requestedAgentId || currentAgentId;
	const isSwitch = targetAgent !== currentAgentId;
	const isIdleEmpty = !hasSession && messageCount === 0;

	switch (intent) {
		case "soft-reload":
			// Resume the same session; nothing to resume on an idle tab.
			return hasSession ? { kind: "resume" } : { kind: "noop" };

		case "restart-agent":
		case "hard-reload":
			// Genuine subprocess respawn, same agent, defer re-acquire.
			return { kind: "respawn-lazy", agentId: targetAgent };

		case "new-chat-in-directory":
			// Directory change always re-acquires (the caller sets the cwd);
			// keep the current agent, defer to first send.
			return { kind: "recreate-lazy", agentId: targetAgent };

		case "switch-agent":
		case "new-chat": {
			if (!isSwitch) {
				// Same agent. "New chat" on an already-empty idle tab is a noop;
				// otherwise clear + reset + defer.
				return isIdleEmpty
					? { kind: "noop" }
					: { kind: "recreate-lazy", agentId: targetAgent };
			}
			// Different agent: swap in place when idle+empty (no eager session),
			// otherwise teardown + reset + defer ("new chat with a different agent").
			return isIdleEmpty
				? { kind: "swap-idle", agentId: targetAgent }
				: { kind: "recreate-lazy", agentId: targetAgent };
		}
	}
}
