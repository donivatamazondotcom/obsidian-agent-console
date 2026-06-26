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

export interface ComposerFocusReturn {
	/** Assigned by InputArea to the composer textarea node (callback ref). */
	composerElRef: MutableRefObject<HTMLTextAreaElement | null>;
	/** Return focus to the composer at end — no-op unless the guardrail is armed. */
	returnFocusToComposer: () => void;
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
		// Obsidian Menu popovers (rendered at document body, outside the panel).
		document.addEventListener("focusin", onFocusIn);
		return () => document.removeEventListener("focusin", onFocusIn);
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

	return { composerElRef, returnFocusToComposer };
}
