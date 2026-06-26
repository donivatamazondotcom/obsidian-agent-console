/**
 * Runtime invariant for the tab-agent / session-acquisition unification
 * ([[Tab Agent Identity and Session Acquisition Unification]] design item #3).
 *
 * The governing invariant of the whole feature:
 *
 *     A tab's LIVE session agent == the tab's SELECTED agent.
 *
 * When the two diverge, the tab is connected to the wrong agent — the exact
 * class of bug this feature closes (switch → type → first message hits the
 * old agent). Per `steering/personal/sdlc.md` § Cross-Boundary State Features,
 * the invariant is checked at the trust boundary and **fails loud, never
 * coerces**: the caller surfaces the violation (throw in dev / log + drop in
 * prod) at the offending write, instead of letting a bad binding surface three
 * symptoms downstream.
 *
 * This module is pure (no React, no Obsidian) so the invariant is unit-testable
 * in isolation and can be called from any of the three boundary points the SDLC
 * prescribes: before a write that binds a session to a tab, after an
 * acquisition resolves, and as an assertion inside the lifecycle/model tests.
 */

export interface TabAgentInvariantInput {
	/** The agent the tab is currently bound to (TabInfo.agentId — source of truth). */
	selectedAgentId: string | null | undefined;
	/**
	 * The agent of the tab's LIVE session, if one exists. `null`/`undefined`
	 * means no live session — vacuously satisfies the invariant (a tab with no
	 * session cannot be bound to the wrong one).
	 */
	liveSessionAgentId: string | null | undefined;
}

export interface TabAgentViolation {
	/** Stable code for log/metric correlation. */
	code: "tab-agent-mismatch";
	/** Human-readable description naming both sides of the mismatch. */
	message: string;
	selectedAgentId: string;
	liveSessionAgentId: string;
}

/**
 * Check the tab-agent invariant. Returns a violation when a LIVE session's
 * agent differs from the tab's selected agent; `null` when the invariant holds
 * (including the vacuous no-live-session case). Never throws — callers decide
 * how loud to be.
 */
export function checkTabAgentInvariant(
	input: TabAgentInvariantInput,
): TabAgentViolation | null {
	const { selectedAgentId, liveSessionAgentId } = input;

	// No live session → nothing to violate. A tab that hasn't acquired yet is
	// always consistent with whatever agent it has selected.
	if (!liveSessionAgentId) return null;

	// No selected agent but a live session exists → can't assert a match; treat
	// as satisfied (the selection is the source of truth and is absent here only
	// in degenerate/test states).
	if (!selectedAgentId) return null;

	if (liveSessionAgentId !== selectedAgentId) {
		return {
			code: "tab-agent-mismatch",
			message:
				`Tab agent invariant violated: live session is bound to ` +
				`"${liveSessionAgentId}" but the tab has "${selectedAgentId}" selected. ` +
				`The session was acquired against the wrong agent.`,
			selectedAgentId,
			liveSessionAgentId,
		};
	}

	return null;
}

/**
 * Fail-loud assertion form. Throws when the invariant is violated. Use at the
 * offending write site in dev / test; in prod the caller should prefer
 * `checkTabAgentInvariant` + log-and-drop so a bad binding never silently
 * persists (per the SDLC "fail loud, never coerce" rule).
 */
export function assertTabAgentInvariant(input: TabAgentInvariantInput): void {
	const violation = checkTabAgentInvariant(input);
	if (violation) {
		throw new Error(violation.message);
	}
}
