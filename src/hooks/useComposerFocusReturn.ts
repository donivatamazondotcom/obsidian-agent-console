/**
 * useComposerFocusReturn — return focus to the composer after an in-panel
 * state change, guarded by "was the user working in the composer?".
 *
 * Spec: [[Composer Focus Return After State Change]].
 *
 * Owns the composer textarea ref (assigned by InputArea) and a `composerHadFocus`
 * flag driven by a document-level `focusin` listener classified through the pure
 * `composer-focus-tracker` reducer. `returnFocusToComposer()` is called from
 * ChatPanel's wrapped state-change handlers (model/mode/config pick, context
 * pin/remove/suppress, reload); it refocuses the composer at the end of the
 * draft IFF the flag is set, deferring the focus to the next frame so it lands
 * after Obsidian's Menu finishes closing and blurring its trigger.
 */

import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { focusComposerAtEnd } from "../ui/composer-focus";
import {
	classifyFocusTarget,
	composerFocusReducer,
	INITIAL_COMPOSER_FOCUS_STATE,
	type ComposerFocusState,
} from "../ui/composer-focus-tracker";
import {
	applyComposerFocus,
	type ComposerAction,
} from "../resolvers/composer-focus";

export interface ComposerFocusReturn {
	/** Assigned by InputArea to the composer textarea node (callback ref). */
	composerElRef: MutableRefObject<HTMLTextAreaElement | null>;
	/** Return focus to the composer at end — no-op unless the guardrail is armed. */
	returnFocusToComposer: () => void;
	/**
	 * Return focus to the composer after a governed user action, per its
	 * {@link ComposerAction} focus contract (unconditional for composer-terminal
	 * actions like send/stop/new-chat; guarded for in-panel adjustments). The
	 * single seam callers use instead of choosing a refocus mechanism ad hoc.
	 */
	focusAfter: (action: ComposerAction) => void;
}

export function useComposerFocusReturn(): ComposerFocusReturn {
	const composerElRef = useRef<HTMLTextAreaElement | null>(null);
	const stateRef = useRef<ComposerFocusState>(INITIAL_COMPOSER_FOCUS_STATE);

	useEffect(() => {
		const onFocusIn = (e: FocusEvent) => {
			const zone = classifyFocusTarget(e.target, composerElRef.current);
			stateRef.current = composerFocusReducer(stateRef.current, zone);
		};
		// focusin bubbles, so a single document-level listener also catches
		// Obsidian Menu popovers (rendered at the document body, outside the
		// panel). Bind to activeDocument (not the main-window document) for
		// popout-window compatibility — same pattern as the document-level
		// listeners in use-auto-scroll-pin.ts.
		activeDocument.addEventListener("focusin", onFocusIn);
		return () => activeDocument.removeEventListener("focusin", onFocusIn);
	}, []);

	const returnFocusToComposer = useCallback(() => {
		// Capture the decision synchronously — the menu closing afterward will
		// move focus to body (an "outside" focusin) and flip the flag, but the
		// user's intent was already recorded at the moment of the pick.
		if (!stateRef.current.composerHadFocus) return;
		const el = composerElRef.current;
		if (!el) return;
		window.requestAnimationFrame(() => focusComposerAtEnd(el));
	}, []);

	// Composer-terminal actions (send/stop/new-chat): refocus regardless of
	// where focus currently sits. A mouse click on the Send button parks focus
	// on the button (outside the composer focus cluster), so the guarded return
	// above would no-op — these must refocus unconditionally (I166).
	const scheduleUnconditionalRefocus = useCallback(() => {
		const el = composerElRef.current;
		if (!el) return;
		window.requestAnimationFrame(() => focusComposerAtEnd(el));
	}, []);

	// The single focus-return seam: routes through the pure contract resolver
	// so callers never pick a refocus mechanism ad hoc.
	const focusAfter = useCallback(
		(action: ComposerAction) => {
			applyComposerFocus(action, {
				focusUnconditional: scheduleUnconditionalRefocus,
				focusGuarded: returnFocusToComposer,
			});
		},
		[scheduleUnconditionalRefocus, returnFocusToComposer],
	);

	return { composerElRef, returnFocusToComposer, focusAfter };
}
