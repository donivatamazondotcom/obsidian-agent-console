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
import { computeDiffLines } from "./toolCallDiff";

type ToolCallContent = Extract<MessageContent, { type: "tool_call" }>;

const PREVIEW_MAX_CHARS = 120;

/**
 * Does this tool call have content blocks the expanded body actually renders?
 *
 * `ToolCallBlock` only renders `diff` and `terminal` blocks (plus the permission
 * banner and, for `execute` calls, a command strip). When a tool call has neither
 * a diff nor a terminal block, the body falls back to rendering the raw
 * input/output payload — see `formatRawPayload`.
 */
export function hasRenderableContent(content: ToolCallContent): boolean {
	return (
		!!content.content &&
		content.content.some(
			(block) => block.type === "diff" || block.type === "terminal",
		)
	);
}

/**
 * Format a rawInput / rawOutput object into the text the expanded body shows
 * for a generic (non-diff, non-terminal) tool call.
 *
 * Pretty-printed JSON is faithful to the payload and gives the renderer and the
 * line-count badge a single shared representation, so the badge can never again
 * promise lines the body doesn't render (the I03 "phantom body" bug). Returns an
 * empty string for absent or empty payloads so the caller can skip the block.
 */
export function formatRawPayload(
	obj: { [k: string]: unknown } | undefined,
): string {
	if (!obj || Object.keys(obj).length === 0) return "";
	try {
		return JSON.stringify(obj, null, 2);
	} catch {
		// Circular or otherwise non-serializable payload — degrade gracefully.
		return "[unserializable payload]";
	}
}

/**
 * Number of lines `JSON.stringify(value, null, 2)` would render, computed
 * structurally WITHOUT building the serialized string.
 *
 * The collapsed line-count badge recomputes on every streaming content update,
 * so serializing the whole payload there (and again in the body) would be an
 * O(size) string allocation per chunk. This walks the value and counts lines
 * instead — staying exactly consistent with what RawPayloadBlock renders on
 * expand, while paying no string-building cost. Strings keep their internal
 * newlines escaped as `\n` in JSON, so each occupies a single line (matching
 * the renderer).
 */
export function countJsonLines(value: unknown): number {
	if (value === null || typeof value !== "object") {
		return 1;
	}
	if (Array.isArray(value)) {
		if (value.length === 0) return 1; // "[]"
		let lines = 2; // "[" and "]"
		for (const item of value) {
			// undefined / function / symbol array elements serialize as `null`.
			lines +=
				item === undefined ||
				typeof item === "function" ||
				typeof item === "symbol"
					? 1
					: countJsonLines(item);
		}
		return lines;
	}
	// Plain object: keys whose value is undefined / function / symbol are omitted.
	const rendered = Object.values(value as { [k: string]: unknown }).filter(
		(v) =>
			v !== undefined && typeof v !== "function" && typeof v !== "symbol",
	);
	if (rendered.length === 0) return 1; // "{}"
	let lines = 2; // "{" and "}"
	for (const v of rendered) {
		lines += countJsonLines(v);
	}
	return lines;
}

/**
 * Count the lines the expanded body will actually render.
 *
 * The count is derived from the SAME inputs the renderer uses, so the
 * `N lines` badge always matches what expansion reveals (see I03 / I79):
 *   - diff blocks → exact `computeDiffLines(block).length`
 *   - terminal blocks → 1 (the placeholder; the live stream length is not
 *     known statically)
 *   - `execute` command strip → 1 when a command is present
 *   - generic tool calls with no diff/terminal block → the rendered
 *     `rawInput` + `rawOutput` payload (via `formatRawPayload`)
 *
 * `rawInput` / `rawOutput` are NOT counted when a diff or terminal renders,
 * because the body does not show them in that case.
 */
export function countLines(content: ToolCallContent): number {
	let total = 0;

	// Command strip — rendered in the expanded header for execute calls.
	if (
		content.kind === "execute" &&
		content.rawInput &&
		typeof content.rawInput.command === "string"
	) {
		total += 1;
	}

	if (hasRenderableContent(content)) {
		// Count exactly what the diff / terminal renderers will show.
		for (const block of content.content || []) {
			if (block.type === "diff") {
				total += computeDiffLines(block).length;
			} else if (block.type === "terminal") {
				// In-message placeholder; live stream length comes later.
				total += 1;
			}
		}
	} else {
		// Generic tool call (e.g. an MCP tool or a subagent "spawn"): the body
		// renders the raw input/output payload as pretty-printed JSON. Count the
		// lines structurally (countJsonLines) rather than serializing here — the
		// badge recomputes on every streaming update, and the full JSON.stringify
		// is deferred to RawPayloadBlock, which only mounts when the user expands.
		if (content.rawInput && Object.keys(content.rawInput).length > 0) {
			total += countJsonLines(content.rawInput);
		}
		if (content.rawOutput && Object.keys(content.rawOutput).length > 0) {
			total += countJsonLines(content.rawOutput);
		}
	}

	return total;
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
