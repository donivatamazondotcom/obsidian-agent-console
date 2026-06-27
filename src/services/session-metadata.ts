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
 * Resolve the title-of-record for a savedSessions entry (I114).
 *
 * Single precedence resolver consulted by the SessionStore single-writer so
 * every writer agrees on the title regardless of save ordering:
 *
 *   AI-suggested  >  existing persisted title  >  first-message-derived
 *
 * - An explicit `suggestedTitle` (the F03 `<title>` marker resolved from the
 *   reply head) always wins — top precedence.
 * - Otherwise the existing persisted title is preserved. This single branch
 *   covers BOTH a prior AI title AND a manual rename (history-modal
 *   `updateSessionTitle`): a messages-only save must never downgrade either to
 *   the crude first-message text. Provenance is intentionally NOT persisted —
 *   "preserve what's there" yields the spec precedence (AI > manual >
 *   first-message) for every real write ordering without a schema migration,
 *   because the only writer that supplies a fresh higher-priority title is the
 *   AI path, and a manual rename is the most recent existing title until then.
 * - With no AI suggestion and no existing title, fall back to the
 *   first-message-derived title (the create-path default).
 *
 * Pure and total; never throws.
 */
export function deriveSessionRecordTitle(inputs: {
	existing?: SavedSessionInfo;
	suggestedTitle?: string | null;
	messages?: ChatMessage[];
}): string {
	const ai = inputs.suggestedTitle?.trim();
	if (ai) return ai;
	if (inputs.existing?.title) return inputs.existing.title;
	return deriveSessionTitle(inputs.messages ?? []);
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
 *
 * I114: the title is resolved via `deriveSessionRecordTitle`, so a write that
 * carries the AI-suggested title sets it (create OR existing path), while a
 * plain messages-only write preserves the existing title (never downgrades a
 * prior AI title or manual rename to the first-message text). Combined with
 * the SessionStore single-writer re-reading the latest snapshot inside its
 * serialized critical section, this removes the stale-snapshot clobber that
 * dropped the AI title from the history record.
 */
export function resolveSessionMetadataWrite(
	existing: SavedSessionInfo | undefined,
	params: {
		sessionId: string;
		agentId: string;
		cwd: string;
		messages: ChatMessage[];
		now: string;
		suggestedTitle?: string | null;
	},
): SavedSessionInfo | null {
	const title = deriveSessionRecordTitle({
		existing,
		suggestedTitle: params.suggestedTitle,
		messages: params.messages,
	});
	if (existing) {
		return { ...existing, title, updatedAt: params.now };
	}
	return {
		sessionId: params.sessionId,
		agentId: params.agentId,
		cwd: params.cwd,
		title,
		createdAt: params.now,
		updatedAt: params.now,
	};
}
