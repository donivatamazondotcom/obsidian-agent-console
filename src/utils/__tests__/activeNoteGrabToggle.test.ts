/**
 * I74: the hotkey toggles GRAB of the active editor note (active-note-scoped).
 *
 * "Present" means the active note is EITHER committed OR currently showing as
 * the dashed provisional (auto-default) pill — so in a fresh session the first
 * press removes a note that already appears, instead of grabbing it.
 *
 *   - present (committed OR provisional) -> ungrab (caller also suppresses
 *     auto-default so the removal sticks)
 *   - absent + room                      -> grab (add as "user")
 *   - absent + cap reached               -> full (can't grab)
 *   - no active note                     -> none (no-op + notice)
 *
 * decideGrabToggle is the pure branch/notice logic; the caller (ChatPanel)
 * performs the add/remove/suppress side effects per the returned action kind.
 */

import { describe, expect, it } from "vitest";
import { decideGrabToggle } from "../activeNoteGrabToggle";
import { MAX_CONTEXT_NOTES, type ContextNote } from "../../types/context";

const note = (path: string): ContextNote => ({ path, source: "user", seen: false });

describe("I74: decideGrabToggle", () => {
	it("grabs the active note when absent and there is room", () => {
		const a = decideGrabToggle({
			activeNotePath: "folder/Design Doc.md",
			activeNoteName: "Design Doc",
			committed: [],
			provisionalPath: null,
		});
		expect(a.kind).toBe("grab");
		expect(a).toMatchObject({ path: "folder/Design Doc.md" });
		expect(a.notice).toMatch(/added|to context/i);
	});

	it("ungrabs the active note when it is committed (regardless of source)", () => {
		const a = decideGrabToggle({
			activeNotePath: "A.md",
			activeNoteName: "A",
			committed: [note("A.md")],
			provisionalPath: null,
		});
		expect(a.kind).toBe("ungrab");
		expect(a).toMatchObject({ path: "A.md" });
		expect(a.notice).toMatch(/removed/i);
	});

	it("ungrabs on FIRST press when the active note is only showing provisionally", () => {
		// Fresh session: auto-default shows A as a dashed provisional pill (not
		// committed). The first press must remove it, not grab/commit it.
		const a = decideGrabToggle({
			activeNotePath: "A.md",
			activeNoteName: "A",
			committed: [],
			provisionalPath: "A.md",
		});
		expect(a.kind).toBe("ungrab");
		expect(a).toMatchObject({ path: "A.md" });
	});

	it("no-ops with a notice when there is no active note", () => {
		const a = decideGrabToggle({
			activeNotePath: null,
			activeNoteName: null,
			committed: [],
			provisionalPath: null,
		});
		expect(a.kind).toBe("none");
		expect(a.notice).toMatch(/no active note/i);
	});

	it("reports full when absent and the cap is reached", () => {
		const committed = Array.from({ length: MAX_CONTEXT_NOTES }, (_, i) =>
			note(`n${i}.md`),
		);
		const a = decideGrabToggle({
			activeNotePath: "C.md",
			activeNoteName: "C",
			committed,
			provisionalPath: null,
		});
		expect(a.kind).toBe("full");
		expect(a.notice).toContain(String(MAX_CONTEXT_NOTES));
	});

	it("prefixes every notice with the Agent Console brand", () => {
		const full = Array.from({ length: MAX_CONTEXT_NOTES }, (_, i) => note(`n${i}.md`));
		const cases = [
			decideGrabToggle({ activeNotePath: "A.md", activeNoteName: "A", committed: [], provisionalPath: null }),
			decideGrabToggle({ activeNotePath: "A.md", activeNoteName: "A", committed: [note("A.md")], provisionalPath: null }),
			decideGrabToggle({ activeNotePath: "A.md", activeNoteName: "A", committed: [], provisionalPath: "A.md" }),
			decideGrabToggle({ activeNotePath: null, activeNoteName: null, committed: [], provisionalPath: null }),
			decideGrabToggle({ activeNotePath: "C.md", activeNoteName: "C", committed: full, provisionalPath: null }),
		];
		for (const c of cases) expect(c.notice).toMatch(/^\[Agent Console\]/);
	});
});
