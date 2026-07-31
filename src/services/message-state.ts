/**
 * Pure functions for message state updates.
 *
 * These functions are extracted from useMessages to keep the hook thin
 * and to allow independent testing. They handle message array transformations
 * for streaming updates, tool call management, and permission state.
 */

import type {
	ChatMessage,
	MessageContent,
	ActivePermission,
	PermissionOption,
} from "../types/chat";
import type { SessionUpdate } from "../types/session";

// ============================================================================
// Types
// ============================================================================

/** Tool call content type extracted for type safety */
export type ToolCallMessageContent = Extract<
	MessageContent,
	{ type: "tool_call" }
>;

// ============================================================================
// Tool Call Merge
// ============================================================================

/**
 * Merge new tool call content into existing tool call.
 * Preserves existing values when new values are undefined.
 */
export function mergeToolCallContent(
	existing: ToolCallMessageContent,
	update: ToolCallMessageContent,
): ToolCallMessageContent {
	// Merge content arrays
	let mergedContent = existing.content || [];
	if (update.content !== undefined) {
		const newContent = update.content || [];

		// If new content contains diff, replace all old diffs
		const hasDiff = newContent.some((item) => item.type === "diff");
		if (hasDiff) {
			mergedContent = mergedContent.filter(
				(item) => item.type !== "diff",
			);
		}

		mergedContent = [...mergedContent, ...newContent];
	}

	return {
		...existing,
		toolCallId: update.toolCallId,
		title: update.title !== undefined ? update.title : existing.title,
		kind: update.kind !== undefined ? update.kind : existing.kind,
		status: update.status !== undefined ? update.status : existing.status,
		content: mergedContent,
		locations:
			update.locations !== undefined
				? update.locations
				: existing.locations,
		rawInput:
			update.rawInput !== undefined &&
			Object.keys(update.rawInput).length > 0
				? update.rawInput
				: existing.rawInput,
		rawOutput:
			update.rawOutput !== undefined &&
			Object.keys(update.rawOutput).length > 0
				? update.rawOutput
				: existing.rawOutput,
		permissionRequest:
			update.permissionRequest !== undefined
				? update.permissionRequest
				: existing.permissionRequest,
	};
}

// ============================================================================
// Message Array Update Functions (for batching)
// ============================================================================

/**
 * I185 — join two streamed text fragments across a block boundary.
 *
 * Raw concatenation is only correct for contiguous stream fragments
 * (mid-sentence chunks of the same block). When a non-text update (tool
 * call, plan) interleaved between two text chunks, the second chunk is a
 * new block: gluing it mid-line destroys line-anchored markdown (a2ui
 * fences, headings, lists — a live ```a2ui fence rendered as raw prose).
 * This join guarantees a paragraph boundary ("\n\n") without stacking
 * extra blank lines when the fragments already carry newlines.
 */
export function joinAtBlockBoundary(a: string, b: string): string {
	if (a === "" || b === "") return a + b;
	const trailing = /\n*$/.exec(a)?.[0].length ?? 0;
	const leading = /^\n*/.exec(b)?.[0].length ?? 0;
	const missing = Math.max(0, 2 - trailing - leading);
	return a + "\n".repeat(missing) + b;
}

/**
 * Apply a "last assistant message" update to the messages array.
 * Creates a new assistant message if needed.
 *
 * `atBlockBoundary` (I185): the incoming text/thought chunk is known to
 * start a new block (a non-text update interleaved since the last text
 * chunk), so merging into an existing item must preserve a paragraph
 * boundary instead of raw-concatenating.
 */
export function applyUpdateLastMessage(
	prev: ChatMessage[],
	content: MessageContent,
	atBlockBoundary = false,
): ChatMessage[] {
	if (prev.length === 0 || prev[prev.length - 1].role !== "assistant") {
		const newMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: "assistant",
			content: [content],
			timestamp: new Date(),
		};
		return [...prev, newMessage];
	}

	const lastMessage = prev[prev.length - 1];
	const updatedMessage = { ...lastMessage };

	if (content.type === "text" || content.type === "agent_thought") {
		const existingContentIndex = updatedMessage.content.findIndex(
			(c) => c.type === content.type,
		);
		if (existingContentIndex >= 0) {
			const existingContent =
				updatedMessage.content[existingContentIndex];
			if (
				existingContent.type === "text" ||
				existingContent.type === "agent_thought"
			) {
				updatedMessage.content[existingContentIndex] = {
					type: content.type,
					text: atBlockBoundary
						? joinAtBlockBoundary(
								existingContent.text,
								content.text,
							)
						: existingContent.text + content.text,
				};
			}
		} else {
			updatedMessage.content.push(content);
		}
	} else {
		const existingIndex = updatedMessage.content.findIndex(
			(c) => c.type === content.type,
		);
		if (existingIndex >= 0) {
			updatedMessage.content[existingIndex] = content;
		} else {
			updatedMessage.content.push(content);
		}
	}

	return [...prev.slice(0, -1), updatedMessage];
}

/**
 * Apply a "last user message" update to the messages array.
 * Creates a new user message if needed. Used for session/load history replay.
 */
export function applyUpdateUserMessage(
	prev: ChatMessage[],
	content: MessageContent,
): ChatMessage[] {
	if (prev.length === 0 || prev[prev.length - 1].role !== "user") {
		const newMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: "user",
			content: [content],
			timestamp: new Date(),
		};
		return [...prev, newMessage];
	}

	const lastMessage = prev[prev.length - 1];
	const updatedMessage = { ...lastMessage };

	if (content.type === "text") {
		const existingContentIndex = updatedMessage.content.findIndex(
			(c) => c.type === "text",
		);
		if (existingContentIndex >= 0) {
			const existingContent =
				updatedMessage.content[existingContentIndex];
			if (existingContent.type === "text") {
				updatedMessage.content[existingContentIndex] = {
					type: "text",
					text: existingContent.text + content.text,
				};
			}
		} else {
			updatedMessage.content.push(content);
		}
	} else {
		const existingIndex = updatedMessage.content.findIndex(
			(c) => c.type === content.type,
		);
		if (existingIndex >= 0) {
			updatedMessage.content[existingIndex] = content;
		} else {
			updatedMessage.content.push(content);
		}
	}

	return [...prev.slice(0, -1), updatedMessage];
}

/**
 * Apply a tool call upsert to the messages array.
 * If a tool call with the given ID exists, merges. Otherwise creates new message.
 */
export function applyUpsertToolCall(
	prev: ChatMessage[],
	content: ToolCallMessageContent,
	toolCallIndex: Map<string, number>,
): ChatMessage[] {
	// O(1) lookup via index
	const messageIdx = toolCallIndex.get(content.toolCallId);
	if (messageIdx !== undefined && messageIdx < prev.length) {
		const message = prev[messageIdx];
		const hasTarget = message.content.some(
			(c) =>
				c.type === "tool_call" && c.toolCallId === content.toolCallId,
		);
		if (hasTarget) {
			const updatedMessage = {
				...message,
				content: message.content.map((c) => {
					if (
						c.type === "tool_call" &&
						c.toolCallId === content.toolCallId
					) {
						return mergeToolCallContent(c, content);
					}
					return c;
				}),
			};
			const result = [...prev];
			result[messageIdx] = updatedMessage;
			return result;
		}
	}

	// Fallback: linear scan (index miss or stale index)
	let found = false;
	const updated = prev.map((message, idx) => {
		const hasTarget = message.content.some(
			(c) =>
				c.type === "tool_call" && c.toolCallId === content.toolCallId,
		);
		if (!hasTarget) return message;
		found = true;
		toolCallIndex.set(content.toolCallId, idx); // Fix stale index
		return {
			...message,
			content: message.content.map((c) => {
				if (
					c.type === "tool_call" &&
					c.toolCallId === content.toolCallId
				) {
					return mergeToolCallContent(c, content);
				}
				return c;
			}),
		};
	});

	if (found) return updated;

	// Not found: create new message and register in index
	toolCallIndex.set(content.toolCallId, prev.length);
	return [
		...prev,
		{
			id: crypto.randomUUID(),
			role: "assistant" as const,
			content: [content],
			timestamp: new Date(),
		},
	];
}

/**
 * Rebuild the tool call index from a messages array.
 */
export function rebuildToolCallIndex(
	messages: ChatMessage[],
	toolCallIndex: Map<string, number>,
): void {
	toolCallIndex.clear();
	messages.forEach((msg, msgIdx) => {
		for (const c of msg.content) {
			if (c.type === "tool_call") {
				toolCallIndex.set(c.toolCallId, msgIdx);
			}
		}
	});
}

/**
 * Cross-update stream memory for block-boundary detection (I185).
 *
 * The messages array alone cannot distinguish "contiguous fragment of the
 * same text block" from "new block after an interleaved tool call": a
 * tool_call_update mutates an existing item in place, leaving the text item
 * positionally unchanged. The caller owns one tracker per stream (same
 * lifetime as the toolCallIndex) and threads it through applySingleUpdate.
 */
export interface StreamContinuity {
	lastApplied: "agent_text" | "agent_thought" | "other" | null;
}

export function createStreamContinuity(): StreamContinuity {
	return { lastApplied: null };
}

/**
 * Apply a single session update to the messages array.
 * Returns the same array reference if no change (session-level updates).
 *
 * `continuity` (optional, I185): mutable per-stream tracker enabling
 * paragraph-boundary insertion when text chunks resume after a non-text
 * update. Omitting it preserves legacy raw concatenation.
 */
export function applySingleUpdate(
	prev: ChatMessage[],
	update: SessionUpdate,
	toolCallIndex: Map<string, number>,
	continuity?: StreamContinuity,
): ChatMessage[] {
	switch (update.type) {
		case "agent_message_chunk": {
			const atBoundary =
				continuity !== undefined &&
				continuity.lastApplied !== null &&
				continuity.lastApplied !== "agent_text";
			if (continuity) continuity.lastApplied = "agent_text";
			return applyUpdateLastMessage(
				prev,
				{
					type: "text",
					text: update.text,
				},
				atBoundary,
			);
		}
		case "agent_thought_chunk": {
			const atBoundary =
				continuity !== undefined &&
				continuity.lastApplied !== null &&
				continuity.lastApplied !== "agent_thought";
			if (continuity) continuity.lastApplied = "agent_thought";
			return applyUpdateLastMessage(
				prev,
				{
					type: "agent_thought",
					text: update.text,
				},
				atBoundary,
			);
		}
		case "user_message_chunk":
			if (continuity) continuity.lastApplied = "other";
			return applyUpdateUserMessage(prev, {
				type: "text",
				text: update.text,
			});
		case "tool_call":
		case "tool_call_update":
			if (continuity) continuity.lastApplied = "other";
			return applyUpsertToolCall(
				prev,
				{
					type: "tool_call",
					toolCallId: update.toolCallId,
					title: update.title,
					status: update.status || "pending",
					kind: update.kind,
					content: update.content,
					locations: update.locations,
					rawInput: update.rawInput,
					rawOutput: update.rawOutput,
					permissionRequest: update.permissionRequest,
				},
				toolCallIndex,
			);
		case "plan":
			if (continuity) continuity.lastApplied = "other";
			return applyUpdateLastMessage(prev, {
				type: "plan",
				entries: update.entries,
			});
		default:
			// Session-level updates don't modify message content and don't
			// break text-block continuity.
			return prev;
	}
}

// ============================================================================
// Permission Helper Functions
// ============================================================================

/**
 * Deactivate every active permission request in the transcript (I174).
 *
 * Used by the stop/interrupt path: `PermissionManager.cancelAll()` emits its
 * `isActive: false` cancellation through the batched update queue, but the
 * interrupt wipes that queue (`discardPendingTurn` / `clearPendingUpdates`),
 * so the cancellation could be lost and the stale block kept
 * `hasActivePermission` stuck true — killing the inactive→active transition
 * that fires permission notifications for the rest of the session. Applying
 * the deactivation directly to the messages source of truth makes Stop
 * deterministic regardless of queue timing.
 *
 * Returns the same array reference when nothing was active (no re-render).
 */
export function cancelActivePermissions(
	messages: ChatMessage[],
): ChatMessage[] {
	let changed = false;
	const next = messages.map((message) => {
		let msgChanged = false;
		const content = message.content.map((block) => {
			if (
				block.type === "tool_call" &&
				block.permissionRequest?.isActive
			) {
				msgChanged = true;
				return {
					...block,
					permissionRequest: {
						...block.permissionRequest,
						isActive: false,
						isCancelled: true,
					},
				};
			}
			return block;
		});
		if (!msgChanged) return message;
		changed = true;
		return { ...message, content };
	});
	return changed ? next : messages;
}

/**
 * Find the active permission request from messages.
 */
export function findActivePermission(
	messages: ChatMessage[],
): ActivePermission | null {
	for (const message of messages) {
		for (const content of message.content) {
			if (content.type === "tool_call") {
				const permission = content.permissionRequest;
				if (permission?.isActive) {
					return {
						requestId: permission.requestId,
						toolCallId: content.toolCallId,
						options: permission.options,
					};
				}
			}
		}
	}
	return null;
}

/**
 * Select an option from the available options based on preferred kinds.
 */
export function selectOption(
	options: PermissionOption[],
	preferredKinds: PermissionOption["kind"][],
	fallback?: (option: PermissionOption) => boolean,
): PermissionOption | undefined {
	for (const kind of preferredKinds) {
		const match = options.find((opt) => opt.kind === kind);
		if (match) return match;
	}
	if (fallback) {
		const fallbackOption = options.find(fallback);
		if (fallbackOption) return fallbackOption;
	}
	return options[0];
}
