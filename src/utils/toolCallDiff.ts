/**
 * Tool-call diff computation (pure, no React).
 *
 * Extracted from `ui/ToolCallBlock.tsx` so that BOTH the renderer (`DiffRenderer`)
 * and the collapsed-summary line count (`utils/toolCallSummary.countLines`) derive
 * from the SAME function. Keeping a single source of truth is what prevents the
 * count badge from diverging from the rendered body (see I79 — the badge used a
 * `max(old,new)+2` heuristic while the body rendered the exact unified diff).
 *
 * `ToolCallBlock.tsx` re-exports `computeDiffLines` so existing importers
 * (e.g. the I78 word-diff test) keep their `../ToolCallBlock` import path.
 */

import * as Diff from "diff";
import type { DiffContent } from "../types/chat";

/**
 * Represents a single line in a diff view.
 * @property type - The type of change: added, removed, or unchanged context
 * @property oldLineNumber - Line number in the old file (undefined for added lines)
 * @property newLineNumber - Line number in the new file (undefined for removed lines)
 * @property content - The text content of the line
 * @property wordDiff - Optional word-level diff for lines that were modified (adjacent removed+added pairs)
 */
export interface DiffLine {
	type: "added" | "removed" | "context";
	oldLineNumber?: number;
	newLineNumber?: number;
	content: string;
	wordDiff?: { type: "added" | "removed" | "context"; value: string }[];
}

/**
 * Check if the diff represents a new file (no old content).
 */
export function isNewFile(diff: DiffContent): boolean {
	return (
		diff.oldText === null ||
		diff.oldText === undefined ||
		diff.oldText === ""
	);
}

// Helper function to map diff parts to our internal format
function mapDiffParts(
	parts: Diff.Change[],
): { type: "added" | "removed" | "context"; value: string }[] {
	return parts.map((part) => ({
		type: part.added ? "added" : part.removed ? "removed" : "context",
		value: part.value,
	}));
}

// Number of context lines to show around changes
export const CONTEXT_LINES = 3;

/**
 * Compute the unified diff lines (with optional word-level diffs) for a file edit.
 * Extracted so the diff-pairing logic can be unit-tested directly (see I78 — word-level
 * diff skipped when the payload lacks a trailing newline) and reused by the line-count
 * badge (see I79).
 */
export function computeDiffLines(diff: DiffContent): DiffLine[] {
	if (isNewFile(diff)) {
		// New file - all lines are added
		const lines = diff.newText.split("\n");
		return lines.map(
			(line, idx): DiffLine => ({
				type: "added",
				newLineNumber: idx + 1,
				content: line,
			}),
		);
	}

	// Use structuredPatch to get a proper unified diff
	// At this point, oldText is guaranteed to be a non-empty string (checked by isNewFile)
	const oldText = diff.oldText || "";
	const patch = Diff.structuredPatch(
		"old",
		"new",
		oldText,
		diff.newText,
		"",
		"",
		{ context: CONTEXT_LINES },
	);

	const result: DiffLine[] = [];
	let oldLineNum = 0;
	let newLineNum = 0;

	// Process hunks
	for (const hunk of patch.hunks) {
		// Add hunk header only if there are multiple hunks
		// (helps users see gaps between different sections of changes)
		if (patch.hunks.length > 1) {
			result.push({
				type: "context",
				content: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
			});
		}

		oldLineNum = hunk.oldStart;
		newLineNum = hunk.newStart;

		for (const line of hunk.lines) {
			const marker = line[0];
			const content = line.substring(1);

			// `structuredPatch` emits a "No newline at end of file" marker
			// line (its marker char is a backslash) whenever a payload lacks
			// a trailing newline. The marker carries no display value here,
			// and left in `result` it sits between a removed and an added
			// line — breaking the removed→added adjacency the word-diff
			// pairing below relies on (see I78). Drop it.
			if (marker === "\\") {
				continue;
			}

			if (marker === "+") {
				result.push({
					type: "added",
					newLineNumber: newLineNum++,
					content,
				});
			} else if (marker === "-") {
				result.push({
					type: "removed",
					oldLineNumber: oldLineNum++,
					content,
				});
			} else {
				// Context line (unchanged)
				result.push({
					type: "context",
					oldLineNumber: oldLineNum++,
					newLineNumber: newLineNum++,
					content,
				});
			}
		}
	}

	// Add word-level diff for modified lines that are adjacent
	for (let i = 0; i < result.length - 1; i++) {
		const current = result[i];
		const next = result[i + 1];

		// If we have a removed line followed by an added line, compute word diff
		if (current.type === "removed" && next.type === "added") {
			const wordDiff = Diff.diffWords(current.content, next.content);
			const mappedDiff = mapDiffParts(wordDiff);
			current.wordDiff = mappedDiff;
			next.wordDiff = mappedDiff;
		}
	}

	return result;
}
