/**
 * Replay context builder for `session/load` failure recovery.
 *
 * When a restored tab calls `session/load(sessionId)` and the agent has
 * forgotten the session (process restarted, server GC'd it, user is on a
 * new agent build), the plugin falls through to `session/new` and
 * synthesises a context block from the locally-stored conversation
 * history. This module produces that block.
 *
 * Format (Decision #7 of [[ACP Tab Persistence Across Restarts]]):
 *
 *     Prior conversation:
 *
 *     **User:** {text}
 *     **Assistant:** {text}
 *     **Assistant called {tool}:** {args} → {output}
 *     ...
 *
 * Header rationale (U58/U59): wrap as a single user-role-tagged block; do
 * NOT use a `**System:**` role label because not every ACP-compatible
 * agent supports system messages, and leaking implementation detail
 * ("here's the synthetic system prompt") into the agent's view of the
 * conversation degrades responses.
 *
 * Tool call rendering:
 *   - Args (rawInput) are JSON-stringified and never truncated (U56).
 *   - Output (rawOutput) is JSON-stringified and capped at 2KB per call
 *     via `truncateToolOutput` (U54/U55/U57). Each call is capped
 *     independently — a previous truncation does not affect the cap of
 *     the next call.
 *
 * Skipped content types for v1 (Approach A.2 is text-only):
 *   - agent_thought (internal reasoning)
 *   - image, resource_link
 *   - plan, permission_request, terminal
 *
 * `text_with_context` (auto-mention context wrapper) renders only its
 * inner text — the mention metadata is not relevant to a fresh agent that
 * has no editor state.
 */

import type { ChatMessage, MessageContent } from "../types/chat";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CAP_BYTES = 2048;
const TRUNCATION_MARKER = "[output truncated]";
const HEADER_LINE = "Prior conversation:";

// ============================================================================
// Encoder/decoder singletons
// ============================================================================

const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder("utf-8", { fatal: true });

// ============================================================================
// truncateToolOutput
// ============================================================================

/**
 * Truncate a string so its UTF-8 byte length does not exceed `capBytes`,
 * appending a `[output truncated]` marker when truncation occurs.
 *
 * Truncation never slices in the middle of a multi-byte UTF-8 codepoint —
 * the returned string is always valid UTF-8.
 *
 * @param output     Already-stringified tool output to truncate.
 * @param capBytes   Maximum total byte length of the result, including
 *                   the truncation marker. Defaults to 2048 (Decision #7).
 * @returns          { text, truncated } pair.
 */
export function truncateToolOutput(
	output: string,
	capBytes: number = DEFAULT_CAP_BYTES,
): { text: string; truncated: boolean } {
	const bytes = encoder.encode(output);
	if (bytes.length <= capBytes) {
		return { text: output, truncated: false };
	}

	const markerByteLen = encoder.encode(TRUNCATION_MARKER).length;
	const allowedBytes = Math.max(0, capBytes - markerByteLen);

	// Walk back to a valid UTF-8 boundary so we don't slice mid-codepoint.
	let safeEnd = Math.min(allowedBytes, bytes.length);
	while (safeEnd > 0) {
		try {
			fatalDecoder.decode(bytes.subarray(0, safeEnd));
			break;
		} catch {
			safeEnd--;
		}
	}

	const safeText =
		safeEnd === 0 ? "" : fatalDecoder.decode(bytes.subarray(0, safeEnd));
	return { text: safeText + TRUNCATION_MARKER, truncated: true };
}

// ============================================================================
// buildReplayContextBlock
// ============================================================================

/**
 * Build the synthetic context block prepended to a freshly-created session
 * after `session/load` fails for a restored tab.
 *
 * @param messages   The locally-stored conversation history (in order).
 * @returns          A single multi-line string suitable for use as a
 *                   single text content block in `session/prompt`.
 *                   Empty string when `messages` is empty.
 */
export function buildReplayContextBlock(messages: ChatMessage[]): string {
	if (messages.length === 0) return "";

	const lines: string[] = [HEADER_LINE, ""];
	for (const message of messages) {
		const renderedBlocks = renderMessage(message);
		for (const block of renderedBlocks) {
			lines.push(block);
		}
	}
	return lines.join("\n");
}

// ============================================================================
// Internal helpers
// ============================================================================

function renderMessage(message: ChatMessage): string[] {
	const lines: string[] = [];
	for (const block of message.content) {
		const rendered = renderContentBlock(block, message.role);
		if (rendered !== null) lines.push(rendered);
	}
	return lines;
}

function renderContentBlock(
	block: MessageContent,
	role: "user" | "assistant",
): string | null {
	switch (block.type) {
		case "text":
			return `**${roleLabel(role)}:** ${block.text}`;
		case "text_with_context":
			return `**${roleLabel(role)}:** ${block.text}`;
		case "tool_call": {
			const toolName = block.title || block.kind || "(unknown)";
			const args = JSON.stringify(block.rawInput ?? {});
			const rawOutputStr = JSON.stringify(block.rawOutput ?? null);
			const { text: output } = truncateToolOutput(rawOutputStr);
			return `**Assistant called ${toolName}:** ${args} → ${output}`;
		}
		// Skipped for v1 (Approach A.2 is text-only):
		case "agent_thought":
		case "image":
		case "resource_link":
		case "plan":
		case "permission_request":
		case "terminal":
			return null;
		default:
			// Exhaustiveness guard — TypeScript will flag any new variant
			// added to MessageContent that hasn't been handled above.
			return null;
	}
}

function roleLabel(role: "user" | "assistant"): string {
	return role === "user" ? "User" : "Assistant";
}
