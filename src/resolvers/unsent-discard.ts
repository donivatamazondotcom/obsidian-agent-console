/**
 * Whether retiring a tab deletes its agent session (I259).
 *
 * An empty tab that connects runs `session/new`, and Kiro CLI V3 lists that
 * session at once. `session/list` has no message count, so the plugin can't
 * hide empty rows without guessing; instead retirement (New chat, agent
 * switch, tab close, idle release, hard reload) deletes a session this
 * process created and never sent to, when the agent advertises
 * `session/delete`.
 *
 * Pure and total: every input maps to a decision; never throws. Precedence
 * follows the field order of {@link UnsentDiscardInput}.
 *
 * Spec: [[I259 Empty Kiro chats pile up in the Agent view]] § Spec 3.
 */

export interface UnsentDiscardInput {
	/** The tab's live agent session id. */
	sessionId: string | null;
	/** The live connection advertises `session/delete`. */
	deletesSessions: boolean;
	/** AcpClient created this id with `session/new` and never prompted it. */
	createdHereUnsent: boolean;
	/** A send was started (still preparing) or is queued for this tab. */
	sendAttempted: boolean;
	/** Messages on screen. */
	messageCount: number;
	/** The tab is bound to a local history record. */
	hasLocalRecord: boolean;
}

export type UnsentDiscardKeepReason =
	| "no-session"
	| "send-attempted"
	| "has-messages"
	| "has-record"
	| "sent-or-not-ours"
	| "no-capability";

export type UnsentDiscardDecision =
	| { kind: "delete"; sessionId: string }
	| { kind: "keep"; reason: UnsentDiscardKeepReason };

export function decideUnsentDiscard(
	input: UnsentDiscardInput,
): UnsentDiscardDecision {
	if (input.sessionId === null) return { kind: "keep", reason: "no-session" };
	if (input.sendAttempted) return { kind: "keep", reason: "send-attempted" };
	if (input.messageCount > 0) return { kind: "keep", reason: "has-messages" };
	if (input.hasLocalRecord) return { kind: "keep", reason: "has-record" };
	if (!input.createdHereUnsent) {
		return { kind: "keep", reason: "sent-or-not-ours" };
	}
	if (!input.deletesSessions) return { kind: "keep", reason: "no-capability" };
	return { kind: "delete", sessionId: input.sessionId };
}
