/**
 * `deriveAgentPickerOptions` — the single pure resolver for what the zero-tab
 * landing's "New chat with an agent" picker offers.
 *
 * WHY THIS EXISTS
 * The picker used to be an inline Obsidian Menu built verbatim from
 * `getAvailableAgents()` — a straight enumeration with no decision. On the
 * landing that has two problems: it offers agents that aren't installed
 * (picking one spawns a tab that dead-ends in getting-started), and it shows a
 * one-item "choice" when only one agent exists (the composer's default launch
 * already covers that). Those are real derivations — which agents, in what
 * order, shown when — so per the "one decision = one pure resolver" tenet they
 * live here, and the imperative menu-building just renders this output.
 *
 * DESIGN
 *  - Gate to DETECTED agents when detection is known; while detection is still
 *    probing (`detected === null`) fall back to all available (optimistic —
 *    matches the landing composer, which assumes an agent is present while
 *    probing rather than flashing an install shell).
 *  - Default agent first, marked `isDefault`; the rest keep their available
 *    order (stable sort).
 *  - `show` is true only when there is a real choice (more than one option) —
 *    a single-agent picker duplicates the composer's default launch.
 *
 * Pure — no React, no Obsidian. Exhaustively unit-testable.
 */

export interface AgentSummary {
	id: string;
	displayName: string;
}

export interface AgentPickerInput {
	/** All configured agents (built-in + custom), in their settings order. */
	available: AgentSummary[];
	/** Detected-as-installed agent ids, or null while detection is unresolved. */
	detected: Set<string> | null;
	/** The default agent id (marked in the options). */
	defaultAgentId: string;
}

export interface AgentPickerOption extends AgentSummary {
	/** True for the default agent (rendered with a "(default)" marker). */
	isDefault: boolean;
}

export interface AgentPickerOptions {
	/** Whether the picker earns its place — true only with a real choice (>1). */
	show: boolean;
	/** Detection-gated, default-first options for the menu. */
	options: AgentPickerOption[];
}

/**
 * The single agent-picker decision. See module doc for the rules.
 */
export function deriveAgentPickerOptions(
	input: AgentPickerInput,
): AgentPickerOptions {
	const { available, detected, defaultAgentId } = input;

	// Gate to detected when known; optimistic (all) while still probing.
	const gated =
		detected === null
			? available
			: available.filter((a) => detected.has(a.id));

	const flagged: AgentPickerOption[] = gated.map((a) => ({
		id: a.id,
		displayName: a.displayName,
		isDefault: a.id === defaultAgentId,
	}));

	// Default first; the rest keep their available order (Array.sort is stable).
	const ordered = [...flagged].sort((a, b) =>
		a.isDefault === b.isDefault ? 0 : a.isDefault ? -1 : 1,
	);

	return { show: ordered.length > 1, options: ordered };
}
