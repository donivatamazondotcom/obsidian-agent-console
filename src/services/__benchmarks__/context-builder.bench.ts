import { bench, describe } from "vitest";

import { buildContextBlocks } from "../context-builder";
import type { ContextNote } from "../../types/context";

/**
 * Gate B-v1 micro-benchmark for `buildContextBlocks` (pure context-assembly
 * path). Tracks per-call cost of assembling prompt context blocks at the max
 * crystallized-note count. A regression here flags the quadratic
 * every-message-injection cost class the perf gate exists to catch.
 *
 * Run: `npm run bench`. Gated (warn-only, phase 1) by `npm run perf:gate`.
 */

function makeNotes(n: number): ContextNote[] {
	const notes: ContextNote[] = [];
	for (let i = 0; i < n; i++) {
		notes.push({
			path: `folder/sub/Note ${i} with a reasonably long title.md`,
			source: "user",
			seen: true,
		});
	}
	return notes;
}

const eightNotes = makeNotes(8); // MAX_CONTEXT_NOTES
const selection = {
	path: "folder/Selected Note.md",
	fromLine: 10,
	toLine: 42,
	text: "Some selected paragraph of text.\n".repeat(40),
};
const vaultPath = "/Users/example/vault";

describe("buildContextBlocks", () => {
	bench("8 notes, reference-only, no selection", () => {
		buildContextBlocks({
			contextNotes: eightNotes,
			selection: null,
			useEmbeddedContext: false,
			vaultPath,
		});
	});

	bench("8 notes, embedded, with selection", () => {
		buildContextBlocks({
			contextNotes: eightNotes,
			selection,
			useEmbeddedContext: true,
			vaultPath,
		});
	});
});
