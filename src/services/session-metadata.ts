/**
 * Pure helpers for saved-session metadata writes.
 *
 * Extracted from useSessionHistory so the turn-end metadata-write decision can
 * be unit-tested without mounting the hook (I58).
 */

import type { ChatMessage } from "../types/chat";
import type { SavedSessionInfo } from "../types/session";

/**
 * Derive a session title (<=50 chars) from the first user message.
 * Falls back to "Session" when no user text is present.
 */
export function deriveSessionTitle(messages: ChatMessage[]): string {
	const firstUser = messages.find((m) => m.role === "user");
	let text = "";
	if (firstUser) {
		for (const block of firstUser.content) {
			if (
				(block.type === "text" ||
					block.type === "text_with_context") &&
				typeof block.text === "string"
			) {
				text = block.text;
				break;
			}
		}
	}
	text = text.trim();
	if (!text) return "Session";
	return text.length > 50 ? text.substring(0, 50) + "..." : text;
}

/**
 * Resolve the savedSessions metadata write performed when a session's
 * transcript is persisted at turn end.
 *
 * I58: a session with a transcript on disk must always have a history entry,
 * otherwise it silently disappears from the Session History modal. When an
 * entry already exists we bump `updatedAt` (last-used ordering). When none
 * exists — e.g. the first-message `saveSessionLocally` gate was skipped on the
 * queued send-before-connect path — we MUST create one here so the session is
 * never orphaned.
 */
export function resolveSessionMetadataWrite(
	existing: SavedSessionInfo | undefined,
	params: {
		sessionId: string;
		agentId: string;
		cwd: string;
		messages: ChatMessage[];
		now: string;
	},
): SavedSessionInfo | null {
	if (existing) {
		return { ...existing, updatedAt: params.now };
	}
	return {
		sessionId: params.sessionId,
		agentId: params.agentId,
		cwd: params.cwd,
		title: deriveSessionTitle(params.messages),
		createdAt: params.now,
		updatedAt: params.now,
	};
}
