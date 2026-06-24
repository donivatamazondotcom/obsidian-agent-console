/**
 * Pure state logic for collapsible agent sections in the settings pane.
 *
 * Collapsed/expanded is per-session UI state (NOT persisted settings — see the
 * Collapsible Agent Sections spec, Decision 3). The settings tab holds an
 * AgentExpansionState; these helpers compute the next state on (re-)render and
 * on user toggle, keeping the DOM-driving logic testable without a live DOM.
 */
export interface AgentExpansionState {
	/** Agent IDs currently expanded. */
	expanded: Set<string>;
	/** Whether the default-agent auto-expand has been seeded this session. */
	initialized: boolean;
	/** The defaultAgentId at last sync, to detect a default change. */
	lastDefaultAgentId: string;
}

/** Fresh, uninitialized state (used on first render and after the tab is hidden). */
export function freshAgentExpansion(): AgentExpansionState {
	return { expanded: new Set<string>(), initialized: false, lastDefaultAgentId: "" };
}

/**
 * Reconcile expansion state on each render against the current default agent.
 *
 * - First render: expand only the default agent (Decision 2).
 * - Default agent changed since last render: fold the old default away and
 *   expand the new one (T03) — other agents' user-set state is preserved.
 * - Otherwise: unchanged (user toggles persist across re-renders — T02).
 *
 * Returns a NEW state object when anything changes; the same reference otherwise.
 */
export function syncAgentExpansion(
	state: AgentExpansionState,
	defaultAgentId: string,
): AgentExpansionState {
	if (!state.initialized) {
		return {
			expanded: new Set<string>([defaultAgentId]),
			initialized: true,
			lastDefaultAgentId: defaultAgentId,
		};
	}
	if (state.lastDefaultAgentId !== defaultAgentId) {
		const expanded = new Set(state.expanded);
		expanded.delete(state.lastDefaultAgentId);
		expanded.add(defaultAgentId);
		return { expanded, initialized: true, lastDefaultAgentId: defaultAgentId };
	}
	return state;
}

/**
 * Apply a user toggle (from a <details> `toggle` event) to the expansion set.
 * Manual collapse of the default agent therefore wins for the rest of the
 * session (the agent is removed from the set and stays removed on re-render).
 */
export function toggleAgentExpansion(
	state: AgentExpansionState,
	agentId: string,
	open: boolean,
): AgentExpansionState {
	const expanded = new Set(state.expanded);
	if (open) {
		expanded.add(agentId);
	} else {
		expanded.delete(agentId);
	}
	return { ...state, expanded };
}
