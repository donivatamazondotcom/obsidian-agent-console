/**
 * I282: the empty conversation area's copy, decided once. Restoring wins,
 * then "this session is no longer on the agent", then the lazy state (I40,
 * I249). Literals only (R5).
 */
import { describe, expect, it } from "vitest";
import { deriveConversationEmptyState } from "../conversation-empty-state";

describe("I282 deriveConversationEmptyState", () => {
	it.each([
		[false, "idle", false, "send-to-connect"],
		[false, "released", false, "send-to-connect"],
		[false, "error", false, "connect-failed"],
		[false, "connecting", false, "connecting"],
		[false, "ready", false, "start"],
		[false, "busy", false, "start"],
		[false, "permission", false, "start"],
		[false, "error", true, "session-gone"],
		[true, "error", true, "restoring"],
	] as const)(
		"restoring %s, state %s, gone %s → %s",
		(isRestoringSession, lazyState, sessionGone, kind) => {
			expect(
				deriveConversationEmptyState({ isRestoringSession, lazyState, sessionGone })
					.kind,
			).toBe(kind);
		},
	);
});
