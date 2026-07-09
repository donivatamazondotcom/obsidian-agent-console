/**
 * `deriveComposerFocusContract` — the single pure resolver for "after this
 * user action, should focus return to the composer?"
 *
 * WHY THIS EXISTS
 * Focus-return after a user action was applied ad-hoc at ~15 scattered sites
 * (InputArea effects, ChatPanel prop wrappers, the quick-prompt bridge), with
 * no single declaration of which actions are "composer-terminal" — the user's
 * next step is to type. New action handlers had no forcing function to declare
 * a focus contract, so they silently shipped without refocus: the Send button,
 * Stop button, and same-agent New-chat gaps (I166) all landed this way.
 *
 * This module is the one place that classifies each governed action. Adding a
 * new member to {@link ComposerAction} without a `case` is a TypeScript compile
 * error (exhaustive switch), so the focus decision is non-skippable at
 * authoring time — mirroring `deriveSendAffordance` (the send-enablement
 * resolver) and the repo's "one decision = one pure, total, tagged-union
 * function" tenet.
 *
 * CONTRACTS
 *  - `unconditional`: the action is composer-terminal — the user is expected to
 *    type next regardless of where DOM focus currently sits. A mouse click on
 *    the Send/Stop button parks focus on the button, which is OUTSIDE the
 *    composer focus cluster, so a *guarded* return reads composerHadFocus=false
 *    and no-ops (the exact I166 bug). These MUST refocus unconditionally.
 *  - `guarded`: an in-panel adjustment (pick a model/mode/config option, pin or
 *    remove a context note, reload). Return focus ONLY if the user was already
 *    working in the composer — otherwise a background tweak yanks focus away
 *    from wherever they actually are.
 *  - `none`: no focus effect.
 *
 * OUT OF SCOPE (governed elsewhere — deliberately NOT routed through this
 * resolver, so they are not `ComposerAction` members):
 *  - Load / fork a session from history: always lands in a new or switched TAB
 *    (`onOpenSessionInTab`), so the tab mount / `isActive` focus effects already
 *    refocus. Never restores in place.
 *  - Tab activate, panel re-show, mount, agent switch, queued edit/delete,
 *    restore-after-cancel: React lifecycle effects keyed on state, not
 *    user-action dispatches — they own their own (tested) focus behaviour.
 *  - Quick-prompt chip fire, picker mouse-pick, remove-attachment, context-pill
 *    click: already refocus via dedicated, tested local handlers.
 *
 * Pure — no React, no Obsidian. Unit-tested exhaustively.
 *
 * Spec: [[Composer Focus Return After State Change]],
 * [[I166 Composer focus not returned after send-stop-new-chat]].
 */

/**
 * User actions whose composer-focus behaviour is governed by this resolver
 * (i.e. routed through the `focusAfter` applier seam in `useComposerFocusReturn`).
 * See the module doc for actions that are deliberately out of scope.
 */
export type ComposerAction =
	// Composer-terminal — unconditional refocus (the user types next no matter
	// where focus currently sits, e.g. after a mouse click on Send/Stop).
	| "send"
	| "stop"
	| "new-chat"
	// In-panel adjustments — guarded refocus (only if the user was in the
	// composer to begin with).
	| "set-model"
	| "set-mode"
	| "set-config-option"
	| "context-add"
	| "context-remove"
	| "suppress-provisional"
	| "reload"
	| "seed-initial-prompt";

export type ComposerFocusContract = "unconditional" | "guarded" | "none";

/**
 * The single composer-focus decision. Exhaustive over {@link ComposerAction}:
 * a new action added to the union without a `case` here fails the build.
 */
export function deriveComposerFocusContract(
	action: ComposerAction,
): ComposerFocusContract {
	switch (action) {
		// Composer-terminal: the user types next regardless of current focus.
		case "send":
		case "stop":
		case "new-chat":
			return "unconditional";
		// In-panel adjustments: only pull focus back if the user was already
		// working in the composer.
		case "set-model":
		case "set-mode":
		case "set-config-option":
		case "context-add":
		case "context-remove":
		case "suppress-provisional":
		case "reload":
		case "seed-initial-prompt":
			return "guarded";
	}
}

/** Handlers the applier dispatches to based on the resolved contract. */
export interface ComposerFocusHandlers {
	/** Refocus the composer regardless of prior focus (composer-terminal). */
	focusUnconditional: () => void;
	/** Refocus only if the user was working in the composer cluster. */
	focusGuarded: () => void;
}

/**
 * Apply the focus contract for an action by dispatching to the matching
 * handler. The single seam every governed action routes through, so the
 * contract cannot be bypassed with an ad-hoc `.focus()` call.
 */
export function applyComposerFocus(
	action: ComposerAction,
	handlers: ComposerFocusHandlers,
): void {
	switch (deriveComposerFocusContract(action)) {
		case "unconditional":
			handlers.focusUnconditional();
			return;
		case "guarded":
			handlers.focusGuarded();
			return;
		case "none":
			return;
	}
}
