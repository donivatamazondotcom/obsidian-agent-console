/**
 * I259: `decideUnsentDiscard` decides whether retiring a tab deletes its
 * agent session. Delete only a session this process created and never sent
 * to, with nothing on screen and no local record, on an agent that
 * advertises `session/delete`. Literal truth table (R5).
 *
 * Spec: [[I259 Empty Kiro chats pile up in the Agent view]] § Spec 3.
 */
import { describe, expect, it } from "vitest";
import {
	decideUnsentDiscard,
	type UnsentDiscardInput,
} from "../unsent-discard";

const deletable: UnsentDiscardInput = {
	sessionId: "sess_1",
	deletesSessions: true,
	createdHereUnsent: true,
	sendAttempted: false,
	messageCount: 0,
	hasLocalRecord: false,
};

describe("decideUnsentDiscard", () => {
	it("deletes an empty session this process created and never sent to", () => {
		expect(decideUnsentDiscard(deletable)).toEqual({
			kind: "delete",
			sessionId: "sess_1",
		});
	});

	it.each([
		["no-session", { sessionId: null }],
		["send-attempted", { sendAttempted: true }],
		["has-messages", { messageCount: 1 }],
		["has-record", { hasLocalRecord: true }],
		["sent-or-not-ours", { createdHereUnsent: false }],
		["no-capability", { deletesSessions: false }],
	] as const)("keeps with reason %s", (reason, patch) => {
		expect(decideUnsentDiscard({ ...deletable, ...patch })).toEqual({
			kind: "keep",
			reason,
		});
	});

	it("applies precedence in field order", () => {
		expect(
			decideUnsentDiscard({
				sessionId: null,
				deletesSessions: false,
				createdHereUnsent: false,
				sendAttempted: true,
				messageCount: 3,
				hasLocalRecord: true,
			}),
		).toEqual({ kind: "keep", reason: "no-session" });
		expect(
			decideUnsentDiscard({
				...deletable,
				sendAttempted: true,
				messageCount: 2,
				hasLocalRecord: true,
				deletesSessions: false,
			}),
		).toEqual({ kind: "keep", reason: "send-attempted" });
		expect(
			decideUnsentDiscard({
				...deletable,
				messageCount: 2,
				hasLocalRecord: true,
				createdHereUnsent: false,
			}),
		).toEqual({ kind: "keep", reason: "has-messages" });
		expect(
			decideUnsentDiscard({
				...deletable,
				hasLocalRecord: true,
				createdHereUnsent: false,
				deletesSessions: false,
			}),
		).toEqual({ kind: "keep", reason: "has-record" });
		expect(
			decideUnsentDiscard({
				...deletable,
				createdHereUnsent: false,
				deletesSessions: false,
			}),
		).toEqual({ kind: "keep", reason: "sent-or-not-ours" });
	});
});
