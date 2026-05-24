/**
 * Tool Call Summary Utilities
 *
 * Pure functions for deriving the one-row summary of a tool-call message:
 *   - countLines: total rendered line count across input + output content
 *   - extractPreviewLine: last meaningful output line, truncated for the summary row
 *
 * Used by `ToolCallBlock` (and any future tool-call surface) to render the
 * collapsed "▶ <tool> · <status> · <preview> [N lines]" row without expanding
 * the full block.
 *
 * Design notes:
 *   - Both functions are pure and easy to unit-test.
 *   - Terminal content carries only a terminalId — its actual output lives
 *     in a separate streaming pipeline (TerminalBlock polls AcpClient.terminal).
 *     For C2/C3 we count the in-message structure only; live terminal-stream
 *     line counting comes in C5 along with the live preview update.
 *   - Diffs count the larger of (oldText lines, newText lines) — the rendered
 *     diff width is dominated by whichever side is bigger plus context.
 *   - rawInput / rawOutput are JSON-serialized only when contributing to the
 *     line count; their nested-object values are flattened to a heuristic
 *     line count rather than rendered.
 */

import type { MessageContent } from "../types/chat";

type ToolCallContent = Extract<MessageContent, { type: "tool_call" }>;

const PREVIEW_MAX_CHARS = 120;

/**
 * Count the total rendered lines for a tool-call message.
 *
 * Includes:
 *   - rawInput body (e.g., command string + args, or script source)
 *   - Each diff block (max of old/new line count, plus a couple lines of chrome)
 *   - Each terminal block (1 line for the placeholder; live stream count
 *     is added by the renderer at expansion time)
 *   - rawOutput structured result, JSON-flattened
 *
 * The number is a rough proxy for "how tall would the expanded block be?"
 * and drives the [N lines] badge in the summary row.
 */
export function countLines(content: ToolCallContent): number {
	let total = 0;

	// rawInput — count newlines in the most likely "body" fields, fall back
	// to JSON serialization for unstructured payloads.
	if (content.rawInput) {
		total += countRawObjectLines(content.rawInput);
	}

	// Per-content-block contribution
	if (content.content) {
		for (const block of content.content) {
			if (block.type === "diff") {
				const oldLines = block.oldText
					? block.oldText.split("\n").length
					: 0;
				const newLines = block.newText
					? block.newText.split("\n").length
					: 0;
				// Rendered diff is roughly max(old, new) + chrome (header,
				// hunk markers). The DiffRenderer adds context lines but
				// we don't model that precisely — close enough for a badge.
				total += Math.max(oldLines, newLines) + 2;
			} else if (block.type === "terminal") {
				// In-message placeholder; live stream length comes later.
				total += 1;
			}
		}
	}

	// rawOutput — same heuristic as rawInput
	if (content.rawOutput) {
		total += countRawObjectLines(content.rawOutput);
	}

	return total;
}

/**
 * Heuristic line count for a rawInput / rawOutput object.
 *
 * Walks string-valued keys (the most common heredoc/script/command payload
 * shape) and adds their newline count. Falls back to a single line for
 * scalar / non-string values; nested objects contribute via recursion.
 */
function countRawObjectLines(obj: { [k: string]: unknown }): number {
	let lines = 0;
	for (const value of Object.values(obj)) {
		if (typeof value === "string") {
			// Most common shape: command body / script source / stdout.
			lines += value.split("\n").length;
		} else if (Array.isArray(value)) {
			// e.g., args: ["-c", "echo hi"] — 1 line per item is overcount,
			// but matches how the args strip is typically rendered.
			lines += value.length;
		} else if (value && typeof value === "object") {
			lines += countRawObjectLines(value as { [k: string]: unknown });
		} else if (value !== undefined && value !== null) {
			lines += 1;
		}
	}
	return lines;
}

/**
 * Extract the "last meaningful output line" for the summary preview.
 *
 * Priority order:
 *   1. rawOutput.stdout — the most common useful signal for shell calls
 *   2. rawOutput.output — generic output field used by some MCP tools
 *   3. rawOutput.error / rawOutput.message — error / message strings
 *   4. The final non-empty line of any string field in rawOutput
 *   5. The title (already in the row, so this is the "no preview" fallback)
 *
 * The returned string is truncated at PREVIEW_MAX_CHARS with an ellipsis.
 * Returns an empty string if no meaningful line could be extracted —
 * the caller should hide the preview slot entirely in that case.
 *
 * Live-streaming preview behavior (C5): each render derives this from the
 * current `content`. As the ACP message-state pipeline mutates `rawOutput`
 * during execution, the preview updates without a separate subscription.
 */
export function extractPreviewLine(content: ToolCallContent): string {
	const candidates: string[] = [];

	if (content.rawOutput) {
		const out = content.rawOutput;
		if (typeof out.stdout === "string") candidates.push(out.stdout);
		if (typeof out.output === "string") candidates.push(out.output);
		if (typeof out.error === "string") candidates.push(out.error);
		if (typeof out.message === "string") candidates.push(out.message);

		// Fallback: any string-valued field
		if (candidates.length === 0) {
			for (const value of Object.values(out)) {
				if (typeof value === "string" && value.trim().length > 0) {
					candidates.push(value);
				}
			}
		}
	}

	for (const candidate of candidates) {
		const lastLine = lastNonEmptyLine(candidate);
		if (lastLine) return truncate(lastLine, PREVIEW_MAX_CHARS);
	}

	return "";
}

function lastNonEmptyLine(text: string): string {
	const lines = text.split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		const trimmed = lines[i].trim();
		if (trimmed.length > 0) return trimmed;
	}
	return "";
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen - 1) + "…";
}
