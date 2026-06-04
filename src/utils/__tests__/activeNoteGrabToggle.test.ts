/**
 * I74 (corrected): the hotkey toggles GRAB of the active editor note.
 *
 * Scoped to the active note's membership:
 *   - active note absent  -> grab it (add as "user")
 *   - active note present -> ungrab it (remove); caller also suppresses
 *     auto-default so the ungrab sticks
 *   - no active note      -> no-op + notice
 *   - context full + absent -> can't grab + notice
 *
 * decideGrabToggle is the pure branch/notice logic; the caller (ChatPanel)
 * performs the add/remove/suppress side effects per the returned action kind.
 */

import { describe, expect, it } from "vitest";
import { decideGrabToggle } from "../activeNoteGrabToggle";
import { MAX_CONTEXT_NOTES } from "../../types/context";

describe("I74: decideGrabToggle", () => {
	it("grabs the active note when it is absent and there is room", () => {
		const a = decideGrabToggle({
			activeNotePath: "folder/Design Doc.md",
			activeNoteName: "Design Doc",
			isPresent: false,
			isFull: false,
		});
		expect(a.kind).toBe("grab");
		expect(a).toMatchObject({ path: "folder/Design Doc.md" });
		expect(a.notice).toContain("Design Doc");
		expect(a.notice).toMatch(/added|to context/i);
	});

	it("ungrabs the active note when it is already present (regardless of source)", () => {
		const a = decideGrabToggle({
			activeNotePath: "A.md",
			activeNoteName: "A",
			isPresent: true,
			isFull: true, // full does not block ungrab
		});
		expect(a.kind).toBe("ungrab");
		expect(a).toMatchObject({ path: "A.md" });
		expect(a.notice).toMatch(/removed/i);
	});

	it("no-ops with a notice when there is no active note", () => {
		const a = decideGrabToggle({
			activeNotePath: null,
			activeNoteName: null,
			isPresent: false,
			isFull: false,
		});
		expect(a.kind).toBe("none");
		expect(a.notice).toMatch(/no active note/i);
	});

	it("reports full when the active note is absent and the cap is reached", () => {
		const a = decideGrabToggle({
			activeNotePath: "C.md",
			activeNoteName: "C",
			isPresent: false,
			isFull: true,
		});
		expect(a.kind).toBe("full");
		expect(a.notice).toContain(String(MAX_CONTEXT_NOTES));
	});

	it("prefixes every notice with the Agent Console brand", () => {
		const cases = [
			decideGrabToggle({ activeNotePath: "A.md", activeNoteName: "A", isPresent: false, isFull: false }),
			decideGrabToggle({ activeNotePath: "A.md", activeNoteName: "A", isPresent: true, isFull: false }),
			decideGrabToggle({ activeNotePath: null, activeNoteName: null, isPresent: false, isFull: false }),
			decideGrabToggle({ activeNotePath: "A.md", activeNoteName: "A", isPresent: false, isFull: true }),
		];
		for (const c of cases) expect(c.notice).toMatch(/^\[Agent Console\]/);
	});
});
