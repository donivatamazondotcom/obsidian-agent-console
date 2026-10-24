/**
 * I212: Diff view renders wrong text in three cases (ported from upstream
 * RAIT-09 0.12.1 fixes ffcac13, 38a0843, d6a57c3).
 *
 * 1. Whitespace: `Diff.diffWords` ignores whitespace, so the word-diff parts
 *    can't rebuild the deleted line verbatim. `- [ ] task` rendered as
 *    `- []\ttask` (the added line's tab, and the space inside the brackets
 *    lost).
 * 2. Block pairing: `structuredPatch` emits all removals then all additions,
 *    so the old adjacent-pair rule highlighted the LAST removed line against
 *    the FIRST added line of every multi-line block — unrelated lines.
 * 3. New file: `split("\n")` leaves an empty item after a terminal newline,
 *    so a new-file diff ended with a phantom blank added row.
 *
 * Assertions are on what the renderer shows: `renderWordDiff` drops `added`
 * parts on a removed line and `removed` parts on an added line, so the
 * visible text of each side is the join of its kept parts.
 */

import { describe, expect, it } from "vitest";

import { computeDiffLines } from "../ToolCallBlock";
import type { DiffLine } from "../../utils/toolCallDiff";

/** The text a line actually displays (mirrors renderWordDiff's filter). */
function displayedText(line: DiffLine): string {
	if (!line.wordDiff) return line.content;
	const skip = line.type === "removed" ? "added" : "removed";
	return line.wordDiff
		.filter((p) => p.type !== skip)
		.map((p) => p.value)
		.join("");
}

describe("I212: diff view correctness", () => {
	it("a deleted line shows its own whitespace, not the added line's", () => {
		const lines = computeDiffLines({
			type: "diff",
			path: "todo.md",
			oldText: "- [ ] task\n",
			newText: "- [x]\ttask\n",
		});
		const removed = lines.find((l) => l.type === "removed");
		const added = lines.find((l) => l.type === "added");
		expect(removed).toBeDefined();
		expect(added).toBeDefined();
		// Word highlighting still applies to a one-line replacement.
		expect(removed!.wordDiff).toBeDefined();
		expect(displayedText(removed!)).toBe("- [ ] task");
		expect(displayedText(added!)).toBe("- [x]\ttask");
	});

	it("does not pair unrelated lines inside a multi-line replacement", () => {
		const lines = computeDiffLines({
			type: "diff",
			path: "a.md",
			oldText: "alpha\nbeta\ngamma\n",
			newText: "one\ntwo\nthree\n",
		});
		const changed = lines.filter((l) => l.type !== "context");
		expect(changed).toHaveLength(6);
		for (const line of changed) {
			expect(line.wordDiff, `${line.type} "${line.content}"`).toBeUndefined();
		}
	});

	it("a new file with a trailing newline has no blank last row", () => {
		const lines = computeDiffLines({
			type: "diff",
			path: "new.md",
			oldText: null,
			newText: "one\ntwo\n",
		});
		expect(lines.map((l) => l.content)).toEqual(["one", "two"]);
		expect(lines.every((l) => l.type === "added")).toBe(true);
	});

	it("a new file whose last line has no newline keeps every line", () => {
		const lines = computeDiffLines({
			type: "diff",
			path: "new.md",
			oldText: null,
			newText: "one\ntwo",
		});
		expect(lines.map((l) => l.content)).toEqual(["one", "two"]);
	});
});
