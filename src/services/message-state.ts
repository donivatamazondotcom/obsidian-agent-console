/**
 * Pure functions for message state updates.
 *
 * These functions are extracted from useMessages to keep the hook thin
 * and to allow independent testing. They handle message array transformations
 * for streaming updates, tool call management, and permission state.
 */

import type {
	ChatMessage,
	ContentTiming,
	MessageContent,
	ActivePermission,
	PermissionOption,
	ToolCallStatus,
	TurnEndKind,
} from "../types/chat";
import type { SessionUpdate } from "../types/session";
import { stripInjectedPromptText } from "./message-sender";
import { GAP_STAMP_THRESHOLD_MS } from "../utils/time-fields";

// ============================================================================
// Types
// ============================================================================

/** Tool call content type extracted for type safety */
export type ToolCallMessageContent = Extract<
	MessageContent,
	{ type: "tool_call" }
>;

/**
 * A tool-call upsert as it arrives: status is optional, as in ACP (I356).
 * A missing status keeps the row's existing one; a new row gets pending.
 */
export type ToolCallUpsert = Omit<ToolCallMessageContent, "status"> & {
	status?: ToolCallStatus;
};

// ============================================================================
// Times (Chat Timestamps)
// ============================================================================

/**
 * Clock input for one applied update. The hook reads the clock once per
 * flush and passes it in, so these functions stay pure and give the same
 * result when React calls an updater twice.
 */
export interface UpdateTiming {
	/** Clock time of the flush this update is applied in (epoch ms). */
	now: number;
	/**
	 * The turn's last live update before this one arrived, attached when it
	 * was queued; null when there is none (no live turn).
	 */
	lastUpdateBefore: number | null;
}

/** Times resolved for one update. `at` is null for replayed history. */
export interface ItemTimes {
	at: number | null;
	gapBefore: boolean;
}

function itemTimes(
	update: SessionUpdate,
	timing: UpdateTiming | undefined,
): ItemTimes | undefined {
	if (!timing) return undefined;
	if (update.replayed) return { at: null, gapBefore: false };
	const gapBefore =
		timing.lastUpdateBefore !== null &&
		timing.now - timing.lastUpdateBefore > GAP_STAMP_THRESHOLD_MS;
	return { at: timing.now, gapBefore };
}

/** Time fields for a newly created content item. */
function stampNew(times: ItemTimes | undefined): ContentTiming {
	return times ? { arrivedAt: times.at, gapBefore: times.gapBefore } : {};
}

/** The time fields an item already has, to keep across a replace. */
function keepTiming(item: MessageContent): ContentTiming {
	const out: ContentTiming = {};
	if (item.arrivedAt !== undefined) out.arrivedAt = item.arrivedAt;
	if (item.gapBefore !== undefined) out.gapBefore = item.gapBefore;
	return out;
}

function messageDate(times: ItemTimes | undefined): Date {
	return times && times.at !== null ? new Date(times.at) : new Date();
}

function isFinished(status: ToolCallStatus | undefined): boolean {
	return status === "completed" || status === "failed";
}

/** A call's own request-to-answer time, when both ends are known. */
function waitBetween(
	requestedAt: number | null | undefined,
	answeredAt: number | null | undefined,
): number | null {
	if (typeof requestedAt !== "number" || typeof answeredAt !== "number") {
		return null;
	}
	return Math.max(0, answeredAt - requestedAt);
}

// ============================================================================
// Tool Call Merge
// ============================================================================

/**
 * Merge new tool call content into existing tool call.
 * Preserves existing values when new values are undefined.
 */
export function mergeToolCallContent(
	existing: ToolCallMessageContent,
	update: ToolCallUpsert,
	/** Flush time (null for replayed); undefined from callers without a clock. */
	at?: number | null,
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

		// I255: a terminal is identified by its terminalId. Agents (Kiro V3)
		// re-send the same terminal item on each tool_call_update; appending
		// it again rendered the output twice. Keep the first occurrence.
		const seenTerminals = new Set(
			mergedContent.flatMap((item) =>
				item.type === "terminal" ? [item.terminalId] : [],
			),
		);
		const additions = newContent.filter((item) => {
			if (item.type !== "terminal") return true;
			if (seenTerminals.has(item.terminalId)) return false;
			seenTerminals.add(item.terminalId);
			return true;
		});

		mergedContent = [...mergedContent, ...additions];
	}

	const merged: ToolCallMessageContent = {
		...existing,
		toolCallId: update.toolCallId,
		title: update.title !== undefined ? update.title : existing.title,
		kind: update.kind !== undefined ? update.kind : existing.kind,
		// I356: an update with no status keeps the existing one.
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

	// Permission times live on the call itself, because permissionRequest is
	// replaced whole on every merge. An update without them keeps the old.
	const requestedAt = update.requestedAt ?? existing.requestedAt;
	const answeredAt = update.answeredAt ?? existing.answeredAt;
	if (requestedAt !== undefined) merged.requestedAt = requestedAt;
	if (answeredAt !== undefined) merged.answeredAt = answeredAt;
	const wait = waitBetween(requestedAt, answeredAt);
	if (wait !== null) merged.waitMs = wait;

	// endedAt is set once, on the first completed or failed status, and never
	// cleared. A call the turn-end closer already ended keeps its endedAt.
	if (
		at !== undefined &&
		typeof existing.endedAt !== "number" &&
		isFinished(update.status)
	) {
		merged.endedAt = at;
	}
	return merged;
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
	times?: ItemTimes,
): ChatMessage[] {
	if (prev.length === 0 || prev[prev.length - 1].role !== "assistant") {
		const newMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: "assistant",
			content: [{ ...content, ...stampNew(times) }],
			timestamp: messageDate(times),
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
				// Spread the existing item so its arrival time survives.
				updatedMessage.content[existingContentIndex] = {
					...keepTiming(existingContent),
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
			updatedMessage.content.push({ ...content, ...stampNew(times) });
		}
	} else {
		const existingIndex = updatedMessage.content.findIndex(
			(c) => c.type === content.type,
		);
		if (existingIndex >= 0) {
			// A plan update replaces the plan but keeps its arrival time.
			updatedMessage.content[existingIndex] = {
				...content,
				...keepTiming(updatedMessage.content[existingIndex]),
			};
		} else {
			updatedMessage.content.push({ ...content, ...stampNew(times) });
		}
	}

	return [...prev.slice(0, -1), updatedMessage];
}

/**
 * Apply a replayed `user_message_chunk` (I222 / I228) — the trust boundary
 * where agent-replayed user text enters message state.
 *
 * The agent replays the prompt it received, so the text carries every block
 * the plugin injected around the user's words. The chunk is joined onto the
 * current user message's text and the result is re-stripped with
 * `stripInjectedPromptText`. Re-stripping the joined text (not the chunk
 * alone) removes a block whose halves arrived in separate chunks: an
 * incomplete block never matches, so it waits for its closing half. Kiro V3
 * `<attached_file>` blocks come back as file chips.
 */
export function applyReplayedUserChunk(
	prev: ChatMessage[],
	chunk: string,
	times?: ItemTimes,
): ChatMessage[] {
	const last = prev[prev.length - 1];
	const current =
		last?.role === "user"
			? last.content.find(
					(c): c is Extract<MessageContent, { type: "text" }> =>
						c.type === "text",
				)
			: undefined;
	// URIs of chips already on this message: they let the strip recognise a
	// Claude `<context ref>` block whose mention arrived in an earlier chunk,
	// and drop a second chip for the same note (I268).
	const chipUris = new Set(
		last?.role === "user"
			? last.content.flatMap((c) =>
					c.type === "resource_link" ? [c.uri] : [],
				)
			: [],
	);
	const { text, links } = stripInjectedPromptText(
		(current?.text ?? "") + chunk,
		chipUris,
	);

	let next = prev;
	if (current) {
		// Replace the text block in place (it already holds earlier chunks).
		next = [
			...prev.slice(0, -1),
			{
				...last,
				content: last.content.map((c) =>
					c === current ? { type: "text" as const, text } : c,
				),
			},
		];
	} else if (text) {
		next = applyUpdateUserMessage(prev, { type: "text", text }, times);
	}
	for (const link of links) {
		if (chipUris.has(link.uri)) continue;
		chipUris.add(link.uri);
		next = applyUpdateUserMessage(next, link, times);
	}
	return next;
}

/**
 * Apply a "last user message" update to the messages array.
 * Creates a new user message if needed. Used for session/load history replay.
 */
export function applyUpdateUserMessage(
	prev: ChatMessage[],
	content: MessageContent,
	times?: ItemTimes,
): ChatMessage[] {
	if (prev.length === 0 || prev[prev.length - 1].role !== "user") {
		const newMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: "user",
			content: [content],
			timestamp: messageDate(times),
			// A prompt rebuilt from the agent's history has no known send time.
			...(times && { sentAt: times.at }),
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
	} else if (content.type === "resource_link") {
		// A message can carry several file chips; each one is kept (I222 a3).
		updatedMessage.content = [...updatedMessage.content, content];
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
	content: ToolCallUpsert,
	toolCallIndex: Map<string, number>,
	times?: ItemTimes,
): ChatMessage[] {
	const at = times?.at;
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
						return mergeToolCallContent(c, content, at);
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
					return mergeToolCallContent(c, content, at);
				}
				return c;
			}),
		};
	});

	if (found) return updated;

	// Not found: create new message and register in index.
	// I356: `pending` only when a row is created for an id not seen before.
	const status = content.status ?? "pending";
	const created: ToolCallMessageContent = {
		...content,
		status,
		...stampNew(times),
	};
	if (times) {
		created.startedAt = times.at;
		if (isFinished(status)) created.endedAt = times.at;
	}
	const wait = waitBetween(content.requestedAt, content.answeredAt);
	if (wait !== null) created.waitMs = wait;
	toolCallIndex.set(content.toolCallId, prev.length);
	return [
		...prev,
		{
			id: crypto.randomUUID(),
			role: "assistant" as const,
			content: [created],
			timestamp: messageDate(times),
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
	/**
	 * Chat Timestamps: the flush's clock and the update's attached last-update
	 * time. Omitted by callers that keep no times; then no time field is set.
	 */
	timing?: UpdateTiming,
): ChatMessage[] {
	const times = itemTimes(update, timing);
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
				times,
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
				times,
			);
		}
		case "user_message_chunk":
			if (continuity) continuity.lastApplied = "other";
			return applyReplayedUserChunk(prev, update.text, times);
		case "tool_call":
		case "tool_call_update":
			if (continuity) continuity.lastApplied = "other";
			return applyUpsertToolCall(
				prev,
				{
					type: "tool_call",
					toolCallId: update.toolCallId,
					title: update.title,
					// I356: missing stays missing; the upsert decides.
					status: update.status,
					kind: update.kind,
					content: update.content,
					locations: update.locations,
					rawInput: update.rawInput,
					rawOutput: update.rawOutput,
					permissionRequest: update.permissionRequest,
					requestedAt: update.requestedAt,
					answeredAt: update.answeredAt,
				},
				toolCallIndex,
				times,
			);
		case "plan":
			if (continuity) continuity.lastApplied = "other";
			return applyUpdateLastMessage(
				prev,
				{
					type: "plan",
					entries: update.entries,
				},
				false,
				times,
			);
		default:
			// Session-level updates don't modify message content and don't
			// break text-block continuity.
			return prev;
	}
}

// ============================================================================
// Turn End (Chat Timestamps)
// ============================================================================

/** What the hook knows at a turn end, read synchronously before the write. */
export interface TurnEndWrite {
	/** The live turn's prompt (`livePromptId`). */
	promptId: string;
	/** The turn-end owner's clock read. */
	now: number;
	kind: TurnEndKind;
	/** Time during the turn when at least one permission was pending. */
	waitMs: number;
}

/**
 * Write a turn's end onto its prompt and close the turn's tool calls that
 * are still open. Pure; the hook calls it at every way a turn ends.
 *
 * A closed call keeps the endedAt it already had and is marked
 * `interrupted`, which wins at render: a later `completed` or `failed` may
 * change its status but not its endedAt. A call whose permission was
 * cancelled with no answer counts as open whatever status cancelAll gave
 * it, and its wait runs to its end.
 *
 * Returns the same array when the prompt isn't in it.
 */
export function applyTurnEnd(
	prev: ChatMessage[],
	write: TurnEndWrite,
): ChatMessage[] {
	const idx = prev.findIndex((m) => m.id === write.promptId);
	if (idx < 0) return prev;
	const next = prev.slice();
	const promptMessage = prev[idx];
	const sentAt =
		typeof promptMessage.sentAt === "number" ? promptMessage.sentAt : null;
	next[idx] = {
		...promptMessage,
		turnEndedAt: write.now,
		turnEndKind: write.kind,
		turnWaitMs: write.waitMs,
		turnMs:
			sentAt === null
				? null
				: Math.max(0, write.now - sentAt - write.waitMs),
	};
	for (let i = idx + 1; i < next.length; i++) {
		const message = next[i];
		let changed = false;
		const content = message.content.map((c) => {
			if (c.type !== "tool_call" || !isOpenCall(c)) return c;
			changed = true;
			return closeCall(c, write.now);
		});
		if (changed) next[i] = { ...message, content };
	}
	return next;
}

function isOpenCall(c: ToolCallMessageContent): boolean {
	if (c.interrupted) return false;
	if (c.status === "pending" || c.status === "in_progress") return true;
	return (
		c.permissionRequest?.isCancelled === true &&
		typeof c.answeredAt !== "number"
	);
}

function closeCall(
	c: ToolCallMessageContent,
	now: number,
): ToolCallMessageContent {
	const endedAt = typeof c.endedAt === "number" ? c.endedAt : now;
	const closed: ToolCallMessageContent = { ...c, endedAt, interrupted: true };
	if (typeof c.requestedAt === "number" && typeof c.answeredAt !== "number") {
		closed.waitMs = Math.max(0, endedAt - c.requestedAt);
	}
	return closed;
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
