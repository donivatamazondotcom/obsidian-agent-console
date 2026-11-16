/**
 * Working face: which transition the working indicator makes when a turn's
 * sending state changes. Pure; the phase hook owns the timer and the DOM.
 *
 * Spec: [[Agent Console Working Face]] § Exit phases, Decision 3.
 */
import type { TurnEnd } from "../types/session";

export type IndicatorTransition =
	/** Sending started: show the working loop. */
	| "start"
	/** Finished without error, cancel, refusal or limit: blink, smile, fade. */
	| "exit-happy"
	/** Any other ending: close the eyes and fade. */
	| "exit-close"
	/** Reduced motion: hide straight away, as before the face. */
	| "hide"
	/** Sending did not change. */
	| "none";

export type IndicatorExit = "exit-happy" | "exit-close";

/**
 * How long each exit plays before the indicator hides (ms). Matches the CSS:
 * eyelid close 0.12 s + dashes-to-happy 0.12 s + hold 0.7 s + fade 0.2 s, and
 * eyelid close 0.12 s + fade 0.2 s.
 */
export const INDICATOR_EXIT_MS: Readonly<Record<IndicatorExit, number>> = {
	"exit-happy": 1140,
	"exit-close": 320,
};

export interface IndicatorTransitionInput {
	wasSending: boolean;
	isSending: boolean;
	/** The `lastTurnEnd` object seen in the previous commit. */
	prevTurnEnd: TurnEnd | null;
	lastTurnEnd: TurnEnd | null;
	reducedMotion: boolean;
}

/** Whether a turn that ended this way earns the happy face. */
function isHappyEnding(outcome: TurnEnd["outcome"]): boolean {
	// "unknown": an agent that sends no or an unrecognized stop reason; the
	// plugin already treats it as done (tab tick, end stamp).
	switch (outcome) {
		case "endTurn":
		case "unknown":
			return true;
		case "cancelled":
		case "maxTokens":
		case "maxRequests":
		case "refusal":
		case "failed":
			return false;
	}
}

export function decideIndicatorTransition(input: IndicatorTransitionInput): IndicatorTransition {
	const { wasSending, isSending, prevTurnEnd, lastTurnEnd, reducedMotion } = input;
	if (wasSending === isSending) return "none";
	if (isSending) return "start";
	if (reducedMotion) return "hide";
	// A turn end counts only when it arrived with this transition: identity,
	// not seq, so a stale end from before a remount never smiles.
	const isNewEnd = lastTurnEnd !== null && lastTurnEnd !== prevTurnEnd;
	return isNewEnd && isHappyEnding(lastTurnEnd.outcome) ? "exit-happy" : "exit-close";
}
