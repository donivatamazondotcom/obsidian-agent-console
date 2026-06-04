/**
 * I74: "Toggle auto-mention" command rewired to the crystallization model.
 *
 * Pre-fix, the command flipped `isAutoMentionDisabled` in useSuggestions —
 * a flag the crystallization send-path never reads, so the hotkey was dead.
 * Option B rewires the command to flip the per-chat `autoDefaultSuppressed`
 * flag (whether the active note auto-pins as default context for this chat).
 *
 * This helper encodes the toggle decision: the next suppressed value and the
 * user-facing Notice. The "will / won't auto-pin" wording is easy to invert,
 * so it is the meaningful unit to guard.
 */

import { describe, expect, it } from "vitest";
import { toggleActiveNoteDefault } from "../activeNoteDefaultToggle";

describe("I74: toggleActiveNoteDefault", () => {
	it("flips not-suppressed -> suppressed (active note will no longer auto-pin)", () => {
		const r = toggleActiveNoteDefault(false);
		expect(r.suppressed).toBe(true);
		expect(r.notice).toContain("won't auto-pin");
	});

	it("flips suppressed -> not-suppressed (active note will auto-pin again)", () => {
		const r = toggleActiveNoteDefault(true);
		expect(r.suppressed).toBe(false);
		expect(r.notice).toContain("will auto-pin");
		expect(r.notice).not.toContain("won't");
	});

	it("prefixes the notice with the Agent Console brand", () => {
		expect(toggleActiveNoteDefault(false).notice).toMatch(
			/^\[Agent Console\]/,
		);
		expect(toggleActiveNoteDefault(true).notice).toMatch(
			/^\[Agent Console\]/,
		);
	});
});
