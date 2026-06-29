/**
 * Pure builder for the cross-agent carry-over PREVIEW shown at the top of a
 * freshly-switched tab.
 *
 * [[Agent-Portable Sessions]] — when the user switches agents and carries the
 * conversation over, the new tab clears its transcript (the new agent didn't
 * produce those turns) but must still SHOW the user what is being carried over,
 * as a distinct read-only block — not as real `ChatMessage`s, so first-message
 * semantics (system-instruction hints, AI-title rubric, auto-default context,
 * first-message history save) are preserved on the next real send.
 *
 * This is the resolver for "what, if anything, should the preview show": a
 * pure, total function with no React/Obsidian dependency, unit-tested in
 * isolation (per [[Agent Console]] § Tenets → pure resolver).
 */

import type { ChatMessage } from "../types/chat";

export interface CarriedOverPreview {
	/** Display name of the agent the conversation was carried over FROM. */
	fromAgent: string;
	/** Flattened text turns, in order, with empty turns dropped. */
	turns: Array<{ role: "user" | "assistant"; text: string }>;
}

/** Flatten a message's text blocks to a single string (non-text blocks ignored). */
function messageToText(msg: ChatMessage): string {
	if (!msg.content || msg.content.length === 0) return "";
	return msg.content
		.filter((b): b is { type: "text"; text: string } => b.type === "text")
		.map((b) => b.text)
		.join("\n");
}

/**
 * Build the preview from the carried-over messages. Returns null when there is
 * nothing meaningful to show (no messages, or only empty/non-text turns), so
 * the caller can render nothing.
 */
export function buildCarriedOverPreview(
	messages: ChatMessage[],
	fromAgent: string,
): CarriedOverPreview | null {
	const turns = messages
		.map((m) => ({ role: m.role, text: messageToText(m) }))
		.filter((t) => t.text.length > 0);
	if (turns.length === 0) return null;
	return { fromAgent, turns };
}
