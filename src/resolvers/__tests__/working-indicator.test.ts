/**
 * Working face: which exit (if any) the indicator plays when a turn's
 * sending state changes.
 *
 * Spec: [[Agent Console Working Face]] § Exit phases, Decision 3.
 * Happy only when the turn finished without error, cancel, refusal or a
 * limit (`endTurn`, or `unknown` for an agent that sends no stop reason);
 * every other ending closes the eyes. Reduced motion skips exits.
 */
import { describe, expect, it } from "vitest";

import { decideIndicatorTransition, INDICATOR_EXIT_MS } from "../working-indicator";
import type { TurnEnd } from "../../types/session";

const OLD: TurnEnd = { seq: 1, outcome: "endTurn" };
const end = (outcome: TurnEnd["outcome"], seq = 2): TurnEnd => ({ seq, outcome });

const base = {
	wasSending: true,
	isSending: false,
	prevTurnEnd: OLD,
	reducedMotion: false,
};

describe("decideIndicatorTransition", () => {
	it.each(["endTurn", "unknown"] as const)("a new %s turn end plays the happy exit", (outcome) => {
		expect(decideIndicatorTransition({ ...base, lastTurnEnd: end(outcome) })).toBe("exit-happy");
	});

	it.each(["cancelled", "maxTokens", "maxRequests", "refusal", "failed"] as const)(
		"a new %s turn end closes the eyes",
		(outcome) => {
			expect(decideIndicatorTransition({ ...base, lastTurnEnd: end(outcome) })).toBe("exit-close");
		},
	);

	it("sending stopped with no new turn end (cleared, discarded) closes", () => {
		expect(decideIndicatorTransition({ ...base, lastTurnEnd: OLD })).toBe("exit-close");
		expect(decideIndicatorTransition({ ...base, prevTurnEnd: null, lastTurnEnd: null })).toBe(
			"exit-close",
		);
	});

	it("a stale successful turn end (same object as before) is not a happy ending", () => {
		const stale = end("endTurn", 9);
		expect(
			decideIndicatorTransition({ ...base, prevTurnEnd: stale, lastTurnEnd: stale }),
		).toBe("exit-close");
	});

	it("reduced motion hides immediately on any ending", () => {
		expect(
			decideIndicatorTransition({ ...base, reducedMotion: true, lastTurnEnd: end("endTurn") }),
		).toBe("hide");
		expect(
			decideIndicatorTransition({ ...base, reducedMotion: true, lastTurnEnd: end("failed") }),
		).toBe("hide");
	});

	it("a turn starting is a start, whatever the last turn end", () => {
		expect(
			decideIndicatorTransition({ ...base, wasSending: false, isSending: true, lastTurnEnd: end("endTurn") }),
		).toBe("start");
	});

	it("no change in sending is no transition", () => {
		expect(
			decideIndicatorTransition({ ...base, wasSending: true, isSending: true, lastTurnEnd: end("endTurn") }),
		).toBe("none");
		expect(
			decideIndicatorTransition({ ...base, wasSending: false, isSending: false, lastTurnEnd: end("endTurn") }),
		).toBe("none");
	});

	it("exit durations match the tuned timings", () => {
		// close 0.12 + happy in 0.12 + hold 0.7 + fade 0.2; close 0.12 + fade 0.2
		expect(INDICATOR_EXIT_MS["exit-happy"]).toBe(1140);
		expect(INDICATOR_EXIT_MS["exit-close"]).toBe(320);
	});
});
