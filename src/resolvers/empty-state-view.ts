/**
 * `deriveEmptyStateView` — the single pure resolver for what an empty-state
 * surface shows in Agent Console.
 *
 * WHY THIS EXISTS
 * Two surfaces render an "empty" screen and must agree on the same affordance
 * rules:
 *   1. The in-tab first-run panel (`GettingStarted` in MessageList) — shown
 *      when a live tab's chat is empty and its agent is not connectable.
 *   2. The zero-tab landing screen (`ZeroTabLanding` in ChatView) — shown when
 *      every tab is closed ([[Agent Console Close Last Tab to Empty State]]).
 * Both offer overlapping affordances (Re-detect, install rows, an escape
 * hatch), but they differ on which ones and when — e.g. the neutral landing
 * never shows Re-detect when an agent is already detected (its point is the
 * action set), whereas the in-tab dead end always offers Re-detect. Encoding
 * those rules inline in each renderer is exactly how the two would drift.
 * This resolver is the one decision both surfaces read.
 *
 * DESIGN
 *  - Input is the orthogonal pair (location, hasDetectedAgent), NOT a
 *    pre-computed reason — the resolver DERIVES the reason so illegal combos
 *    (e.g. "no-tabs" but no agent, tagged as the detected variant) are
 *    unrepresentable in the output.
 *  - `reason` is the discriminant carried through to the renderer + telemetry;
 *    the boolean affordance flags are the render decisions, resolved once here
 *    so no consumer re-derives `reason === "…"` inline.
 *  - Governing rule (§ Harmonization with I-FRO6): Re-detect ONLY re-runs
 *    detection — it never launches. It is shown on any detection gap
 *    (in-tab always; landing only when no agent is detected), and hidden on
 *    the neutral landing when an agent IS detected (there the action set is
 *    the point).
 *
 * Pure — no React, no Obsidian. Exhaustively unit-testable (4 input rows).
 */

/** Where the empty state renders. */
export type EmptyStateLocation = "in-tab" | "no-tabs";

/**
 * The resolved reason, discriminating the three empty-state situations.
 * Carried to the renderer so a consumer never re-derives it from the inputs.
 */
export type EmptyStateReason =
	| "no-agent-in-tab" // in a live tab, the current agent is not connectable
	| "no-tabs" // zero-tab landing with at least one agent detected
	| "no-tabs-no-agent"; // zero-tab landing with no agent detected

export interface EmptyStateInput {
	/** Where the empty state renders. */
	location: EmptyStateLocation;
	/** Whether at least one agent is detected as installed on the machine. */
	hasDetectedAgent: boolean;
}

/**
 * The resolved empty-state view. `reason` is the discriminant; the flags are
 * the render decisions (each surface shows exactly the affordances flagged
 * true). Resolved once so the two surfaces cannot drift.
 */
export interface EmptyStateView {
	reason: EmptyStateReason;
	/** Re-detect button — re-runs detection only, never launches a session. */
	showRedetect: boolean;
	/** One-line install rows for the built-in npm agents (no agent available). */
	showInstallRows: boolean;
	/** Detected agents as one-click picks (in-tab: switches the tab's agent). */
	showAgentPicks: boolean;
	/** The neutral-landing action set (New chat / New chat with an agent / …). */
	showLandingActions: boolean;
	/** "Open settings" escape hatch. */
	showSettings: boolean;
	/** "Already installed elsewhere? Set its path in settings." manual-path hint. */
	showManualPathHint: boolean;
}

/**
 * The single empty-state affordance decision. See module doc for the rules.
 */
export function deriveEmptyStateView(input: EmptyStateInput): EmptyStateView {
	const { location, hasDetectedAgent } = input;

	if (location === "in-tab") {
		// In-tab first-run dead end (I-FRO6): always offer Re-detect + settings
		// + the manual-path hint. Detected agents show as one-click picks;
		// otherwise show install rows. Never the neutral-landing action set.
		return {
			reason: "no-agent-in-tab",
			showRedetect: true,
			showInstallRows: !hasDetectedAgent,
			showAgentPicks: hasDetectedAgent,
			showLandingActions: false,
			showSettings: true,
			showManualPathHint: true,
		};
	}

	// location === "no-tabs"
	if (hasDetectedAgent) {
		// Neutral landing with an agent available: the action set is the point.
		// Re-detect is hidden (nothing is a dead end), no install rows, no picks.
		return {
			reason: "no-tabs",
			showRedetect: false,
			showInstallRows: false,
			showAgentPicks: false,
			showLandingActions: true,
			showSettings: false,
			showManualPathHint: false,
		};
	}

	// Neutral landing with no agent detected: mirror the in-tab no-agent set
	// (install rows + Re-detect + settings + hint). Do NOT offer the launch
	// actions — a New chat would spawn a tab on an uninstalled agent. Stays on
	// the landing after a re-probe (no auto-launch, Decision 5).
	return {
		reason: "no-tabs-no-agent",
		showRedetect: true,
		showInstallRows: true,
		showAgentPicks: false,
		showLandingActions: false,
		showSettings: true,
		showManualPathHint: true,
	};
}
