/**
 * Composer focus-return guardrail — pure logic.
 *
 * Spec: [[Composer Focus Return After State Change]] (Decision D5).
 *
 * After an in-panel state change (model/mode/config pick, context pin/remove,
 * reload) we return focus to the composer at the end of the draft — but ONLY
 * if the user was already working in the composer. The guardrail is a single
 * boolean, `composerHadFocus`, driven by classified `focusin` events:
 *
 *   - focus enters the COMPOSER          → composerHadFocus = true
 *   - focus stays within the CLUSTER     → unchanged (composer → dropdown →
 *                                           menu item keeps the flag set, so a
 *                                           keyboard pick still returns focus)
 *   - focus moves OUTSIDE the cluster    → composerHadFocus = false (a note,
 *                                           the message list, another pane)
 *
 * The "cluster" = the composer textarea + the registered trigger controls
 * (tagged `data-acp-focus-cluster`) + their transient Obsidian `.menu`
 * popovers (which render at document body, outside the panel subtree).
 *
 * Both functions are pure so the truth table (spec T8) is unit-testable
 * without a live Obsidian or a mounted React tree.
 */

/** Where an observed focus target sits relative to the composer cluster. */
export type FocusZone = "composer" | "cluster" | "outside";

export interface ComposerFocusState {
	composerHadFocus: boolean;
}

export const INITIAL_COMPOSER_FOCUS_STATE: ComposerFocusState = {
	composerHadFocus: false,
};

/** Marker attribute placed on trigger controls so focusin can classify them. */
export const FOCUS_CLUSTER_ATTR = "data-acp-focus-cluster";

/**
 * Advance the guardrail state given the zone the focus moved into.
 *
 * - composer: the user is in the composer — arm focus-return.
 * - cluster:  focus is on a trigger control or its menu — preserve the flag
 *             so a pick made via that control still returns focus.
 * - outside:  the user left the composer's working area — disarm.
 */
export function composerFocusReducer(
	state: ComposerFocusState,
	zone: FocusZone,
): ComposerFocusState {
	switch (zone) {
		case "composer":
			return state.composerHadFocus ? state : { composerHadFocus: true };
		case "cluster":
			return state;
		case "outside":
			return state.composerHadFocus ? { composerHadFocus: false } : state;
	}
}

/**
 * Classify a `focusin` target relative to the composer cluster.
 *
 * @param target     the `focusin` event target (EventTarget | null)
 * @param composerEl the composer textarea, or null before it mounts
 */
export function classifyFocusTarget(
	target: EventTarget | null,
	composerEl: HTMLElement | null,
): FocusZone {
	if (!(target instanceof HTMLElement)) return "outside";
	if (composerEl && target === composerEl) return "composer";
	// Trigger controls are tagged; their Obsidian Menu popover renders at body
	// with class `.menu`. Either keeps the flag set so a pick returns focus.
	if (target.closest(`[${FOCUS_CLUSTER_ATTR}]`)) return "cluster";
	if (target.closest(".menu")) return "cluster";
	return "outside";
}
