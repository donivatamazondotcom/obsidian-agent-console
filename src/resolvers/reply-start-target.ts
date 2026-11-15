/**
 * Jump to start of latest reply — where the agent's final response starts,
 * and whether the up button shows.
 *
 * A turn is several assistant messages: every tool call starts a new one
 * (applyUpsertToolCall), and all text within one message merges into one
 * `text` item (applyUpdateLastMessage). The latest turn is everything after
 * the last user message. Its target is the last assistant message with
 * non-empty text (the final answer, walking back past trailing tool calls);
 * a turn with no text targets its first assistant row; an empty turn has
 * none.
 *
 * Read by both the up button (via JumpToReplyStartAnchor) and the
 * "Jump to start of latest reply" command, so the two can't disagree.
 * Pure: no React, no Obsidian.
 *
 * Spec: [[Jump to Start of Latest Reply]] § Behavior 2-4, § Mechanism.
 */
import type { ChatMessage, MessageContent } from "../types/chat";

export type ReplyStartTarget =
	| { kind: "text"; messageId: string }
	| { kind: "row"; messageId: string }
	| { kind: "none" };

export type ReplyStartTargetKind = ReplyStartTarget["kind"];

/**
 * True when the content holds a `text` item with visible characters. Shared
 * with MessageBubble's `data-reply-text-start` attribute so the attribute
 * and the target can't disagree.
 */
export function hasNonEmptyText(content: MessageContent[]): boolean {
	return content.some((c) => c.type === "text" && c.text.trim() !== "");
}

/**
 * The start of the latest turn's final response. O(messages in the latest
 * turn); typically one message is checked.
 */
export function deriveReplyStartTarget(messages: ChatMessage[]): ReplyStartTarget {
	let firstAssistantId: string | null = null;
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role === "user") break;
		if (message.role !== "assistant") continue;
		if (hasNonEmptyText(message.content)) {
			return { kind: "text", messageId: message.id };
		}
		firstAssistantId = message.id;
	}
	return firstAssistantId === null
		? { kind: "none" }
		: { kind: "row", messageId: firstAssistantId };
}

/** Stable identity of a target, used to key the visibility observation. */
export function replyStartTargetKey(target: ReplyStartTarget): string {
	switch (target.kind) {
		case "none":
			return "none";
		case "text":
		case "row":
			return `${target.kind}:${target.messageId}`;
	}
}

/**
 * Rebuild a target from the anchor component's two primitive props. An
 * invalid combination (a kind that needs an id but has none, or `none`
 * with an id) is `none`.
 */
export function replyStartTargetFromParts(
	kind: ReplyStartTargetKind,
	messageId: string | null,
): ReplyStartTarget {
	switch (kind) {
		case "none":
			return { kind: "none" };
		case "text":
		case "row":
			return messageId === null ? { kind: "none" } : { kind, messageId };
	}
}

export interface JumpButtonVisibilityInput {
	isSending: boolean;
	/** The tab is acquiring its session (`lazyState === "connecting"`). */
	isAcquiring: boolean;
	target: ReplyStartTarget;
	/**
	 * The latest IntersectionObserver report for `key`: whether the target's
	 * top is above the message list's top edge. Null until the first entry.
	 */
	observed: { key: string; above: boolean } | null;
}

/**
 * The up button shows only when the agent is idle, the session isn't being
 * acquired, a target exists, and the observer has reported — for this same
 * target — that its top is above the list's top edge.
 */
export function deriveJumpButtonVisible(input: JumpButtonVisibilityInput): boolean {
	const { isSending, isAcquiring, target, observed } = input;
	if (isSending || isAcquiring) return false;
	switch (target.kind) {
		case "none":
			return false;
		case "text":
		case "row":
			return (
				observed !== null &&
				observed.key === replyStartTargetKey(target) &&
				observed.above
			);
	}
}
