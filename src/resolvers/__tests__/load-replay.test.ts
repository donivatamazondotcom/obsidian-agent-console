/**
 * I264 — `decideLoadReplay` truth table.
 *
 * Kiro V3 answers `session/load` for an id it never had with success and no
 * conversation replay (probed 2026-11-02). A load that replays nothing while a
 * transcript is on screen is an empty load; everything else loaded. A missing
 * count (resume, or an agent path that doesn't count) can't be judged, so it
 * loads. Literals only (R5).
 */
import { describe, expect, it } from "vitest";
import { decideLoadReplay } from "../load-replay";

describe("I264 decideLoadReplay", () => {
	it.each([
		[0, true, "empty"],
		[0, false, "loaded"],
		[1, true, "loaded"],
		[2, false, "loaded"],
		[undefined, true, "loaded"],
		[undefined, false, "loaded"],
	] as const)(
		"replayed %s, transcript on screen %s → %s",
		(replayedConversationUpdates, haveLocalHistory, kind) => {
			expect(
				decideLoadReplay({ replayedConversationUpdates, haveLocalHistory })
					.kind,
			).toBe(kind);
		},
	);
});
