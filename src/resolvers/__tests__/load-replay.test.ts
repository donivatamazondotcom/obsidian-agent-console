/**
 * I264 — `decideLoadReplay` truth table.
 *
 * Kiro V3 answers `session/load` for an id it never had with success and no
 * conversation replay (probed 2026-11-02). A load that replays nothing when a
 * conversation is expected is an empty load; everything else loaded. A
 * conversation is expected when a transcript is on screen (I264) or when the
 * row has no local record, so opening it is the import (I282). A missing
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
		"replayed %s, conversation expected %s → %s",
		(replayedConversationUpdates, expectsConversation, kind) => {
			expect(
				decideLoadReplay({ replayedConversationUpdates, expectsConversation })
					.kind,
			).toBe(kind);
		},
	);
});
