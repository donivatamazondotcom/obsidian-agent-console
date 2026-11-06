import type { TabSessionState } from "../types/tab";

/**
 * What the empty conversation area of a tab says (I40, I249, I282).
 *
 * Precedence: restoring, then a session the agent no longer has (I282), then
 * the lazy state. Pure and total.
 */
export type ConversationEmptyState =
	| { kind: "restoring" }
	| { kind: "session-gone" }
	| { kind: "send-to-connect" }
	| { kind: "connect-failed" }
	| { kind: "connecting" }
	| { kind: "start" };

export function deriveConversationEmptyState(input: {
	isRestoringSession: boolean;
	lazyState: TabSessionState;
	sessionGone: boolean;
}): ConversationEmptyState {
	if (input.isRestoringSession) return { kind: "restoring" };
	if (input.sessionGone) return { kind: "session-gone" };
	switch (input.lazyState) {
		case "idle":
		case "released":
			return { kind: "send-to-connect" };
		case "error":
			return { kind: "connect-failed" };
		case "connecting":
			return { kind: "connecting" };
		case "ready":
		case "busy":
		case "permission":
			return { kind: "start" };
	}
}

/**
 * Whether the "History not stored locally – Reload from agent" banner (I72)
 * shows. Hidden once a session is live, any message is shown, or the agent
 * said the session is gone (I282: reloading it would fail the same way).
 */
export function shouldShowRecoverableHistory(input: {
	historyRecoverable: boolean;
	messageCount: number;
	sessionId: string | null;
	sessionGone: boolean;
}): boolean {
	return (
		input.historyRecoverable &&
		input.messageCount === 0 &&
		input.sessionId === null &&
		!input.sessionGone
	);
}
