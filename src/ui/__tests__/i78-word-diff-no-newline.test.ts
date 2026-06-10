/**
 * I78: Word-level diff highlighting skipped when the diff payload lacks a
 * trailing newline.
 *
 * Repro: a single-line `strReplace`-style edit whose old/new payloads have no
 * trailing newline. `Diff.structuredPatch` then emits a
 * `\ No newline at end of file` marker line *between* the removed and added
 * lines. The word-diff pairing loop only computes `Diff.diffWords` when a
 * `removed` line is *immediately* followed by an `added` line, so the
 * interposed marker breaks adjacency and the intra-line bold (added) /
 * strikethrough (removed) emphasis never fires.
 *
 * This test asserts the removed/added pair gets a populated `wordDiff`. It
 * fails (red) against the unfixed code because `wordDiff` is left undefined,
 * and passes once the No-newline marker is excluded from `result`.
 *
 * Root cause + fix: see [[I78 Word-level diff highlighting skipped when diff
 * payload lacks trailing newline]].
 */

import { describe, expect, it } from "vitest";

import { computeDiffLines } from "../ToolCallBlock";

describe("I78: word-level diff with no trailing newline", () => {
	it("populates wordDiff for a single-line edit whose payload has no trailing newline", () => {
		// kiro-cli's common single-line strReplace shape: bare snippet, no \n.
		const diff = {
			type: "diff" as const,
			path: "test.ts",
			oldText: 'const color = "green";',
			newText: 'const color = "emerald";',
		};

		const lines = computeDiffLines(diff);
		const removed = lines.find((l) => l.type === "removed");
		const added = lines.find((l) => l.type === "added");

		expect(removed, "expected a removed line").toBeDefined();
		expect(added, "expected an added line").toBeDefined();

		// The bug: these are undefined on the unfixed code because the
		// `\ No newline at end of file` marker sits between removed and added.
		expect(
			removed?.wordDiff,
			"removed line should carry a word-level diff",
		).toBeDefined();
		expect(removed?.wordDiff?.length ?? 0).toBeGreaterThan(0);
		expect(
			added?.wordDiff,
			"added line should carry a word-level diff",
		).toBeDefined();
		expect(added?.wordDiff?.length ?? 0).toBeGreaterThan(0);

		// And the word-level parts must capture the actual change.
		const addedWords = (removed?.wordDiff ?? [])
			.filter((p) => p.type === "added")
			.map((p) => p.value)
			.join("");
		const removedWords = (removed?.wordDiff ?? [])
			.filter((p) => p.type === "removed")
			.map((p) => p.value)
			.join("");
		expect(addedWords).toContain("emerald");
		expect(removedWords).toContain("green");
	});

	it("does not leak the No-newline marker into the rendered diff lines", () => {
		const diff = {
			type: "diff" as const,
			path: "test.ts",
			oldText: 'const color = "green";',
			newText: 'const color = "emerald";',
		};

		const lines = computeDiffLines(diff);

		// The `\ No newline at end of file` plumbing carries no display value
		// here; it must not appear as a context line.
		const hasNoNewlineMarker = lines.some((l) =>
			l.content.includes("No newline at end of file"),
		);
		expect(hasNoNewlineMarker).toBe(false);
	});

	it("control: trailing-newline payload already produces word-level diff", () => {
		// The confirmed inverse — a payload ending at a line boundary emits no
		// No-newline marker, so adjacency (and word diff) already works. Guards
		// against the fix accidentally breaking the already-working case.
		const diff = {
			type: "diff" as const,
			path: "test.ts",
			oldText: 'const color = "green";\n',
			newText: 'const color = "emerald";\n',
		};

		const lines = computeDiffLines(diff);
		const removed = lines.find((l) => l.type === "removed");
		const added = lines.find((l) => l.type === "added");

		expect(removed?.wordDiff?.length ?? 0).toBeGreaterThan(0);
		expect(added?.wordDiff?.length ?? 0).toBeGreaterThan(0);
	});
});
