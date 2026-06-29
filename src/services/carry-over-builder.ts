/**
 * Carry-over transcript builder — prepares earlier messages for injection
 * into a fresh session on a different agent.
 *
 * Budget: 10,000 char cap (settled decision #1). Oldest turns dropped first;
 * a "earlier messages trimmed" notice inserted when truncation occurs.
 *
 * Output is a single string ready for context-block injection via
 * message-sender.ts (resource block or XML text block, depending on
 * embeddedContext support).
 *
 * See [[Agent-Portable Sessions]] § Settled decisions.
 */

import type { ChatMessage, PromptContent } from "../types/chat";

export const CARRY_OVER_BUDGET = 10_000;
const TRIM_NOTICE = "[Earlier messages trimmed]\n\n";

/**
 * Extract plain text from a message's content blocks.
 */
function messageToText(msg: ChatMessage): string {
	if (!msg.content || msg.content.length === 0) return "";
	return msg.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

/**
 * Format a single message as a transcript line.
 */
function formatMessage(msg: ChatMessage): string {
	const role = msg.role === "user" ? "User" : "Assistant";
	const text = messageToText(msg);
	if (!text) return "";
	return `${role}: ${text}`;
}

/**
 * Build the carry-over transcript string from a message array, respecting
 * the char budget. Returns null if there are no meaningful messages to carry.
 *
 * Strategy: keep as many recent turns as fit within the budget. Start from
 * the most recent message and work backward; once we exceed the budget,
 * prepend the trim notice.
 */
export function buildCarryOverTranscript(
	messages: ChatMessage[],
	budget: number = CARRY_OVER_BUDGET,
): string | null {
	if (messages.length === 0) return null;

	const formatted: string[] = [];
	let totalChars = 0;
	let trimmed = false;

	// Walk from newest to oldest
	for (let i = messages.length - 1; i >= 0; i--) {
		const line = formatMessage(messages[i]);
		if (!line) continue;

		const lineLen = line.length + 2; // +2 for \n\n separator
		if (totalChars + lineLen > budget) {
			trimmed = true;
			break;
		}
		formatted.unshift(line);
		totalChars += lineLen;
	}

	if (formatted.length === 0) return null;

	const transcript = formatted.join("\n\n");
	return trimmed ? TRIM_NOTICE + transcript : transcript;
}

/**
 * Build PromptContent blocks for carrying over a transcript to a new agent.
 *
 * Dual-path: resource block when the agent supports embeddedContext,
 * XML text block otherwise (same pattern as context-builder.ts).
 */
export function buildCarryOverBlocks(
	messages: ChatMessage[],
	supportsEmbeddedContext: boolean,
	budget: number = CARRY_OVER_BUDGET,
): PromptContent[] {
	const transcript = buildCarryOverTranscript(messages, budget);
	if (!transcript) return [];

	if (supportsEmbeddedContext) {
		return [
			{
				type: "resource",
				resource: {
					uri: "agent-console://carry-over-transcript",
					mimeType: "text/plain",
					text: transcript,
				},
				annotations: {
					audience: ["assistant"],
					priority: 0.8,
				},
			},
			{
				type: "text",
				text: "The messages above are from an earlier conversation the user carried over when switching to you. Continue from where they left off.",
			},
		];
	}

	// XML fallback for agents without embeddedContext support
	return [
		{
			type: "text",
			text: `<carry_over_transcript>\nThe following messages are from an earlier conversation the user carried over when switching to you. Continue from where they left off.\n\n${transcript}\n</carry_over_transcript>`,
		},
	];
}
