import { bench, describe } from "vitest";

import { sanitizeContextNotes } from "../context-validator";

/**
 * Gate B-v1 micro-benchmark for `sanitizeContextNotes` (pure validation at
 * the context trust boundary). Runs on every session restore
 * (session-storage) and every context-note update (useContextNotes), so a
 * regression here taxes the restore + edit hot paths.
 *
 * Run: `npm run bench`. Gated (warn-only, phase 1) by `npm run perf:gate`.
 */

// Raw input as it arrives from a deserialized session file: valid entries
// plus a few malformed ones to exercise the validation / drop branches.
const rawNotes: unknown[] = [];
for (let i = 0; i < 8; i++) {
	rawNotes.push({ path: `folder/Note ${i}.md`, source: "user", seen: true });
}
rawNotes.push({ path: "", source: "user", seen: true }); // empty path
rawNotes.push({ path: "x.md", source: "bogus", seen: true }); // bad source
rawNotes.push({ source: "user", seen: false }); // missing path
rawNotes.push(null); // non-object

describe("sanitizeContextNotes", () => {
	bench("8 valid + 4 malformed (restore validation path)", () => {
		sanitizeContextNotes(rawNotes);
	});
});
