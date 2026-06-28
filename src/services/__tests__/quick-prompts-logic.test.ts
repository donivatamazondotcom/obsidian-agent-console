/**
 * Unit tests for quick-prompts-logic (pure).
 *
 * Covers Txx T01–T14 from [[Agent Console Quick Prompts and Workflows]]
 * § Test Cases (core slice). TDD — written against the approved acceptance
 * cases before the hook/modal/plugin wiring.
 */
import { describe, it, expect, vi } from "vitest";
import {
	stripFrontmatter,
	deriveLabel,
	slugifyPromptId,
	buildQuickPrompt,
	isQuickPromptFile,
	resolvePromptText,
	decideQuickPromptAction,
	planQuickPromptFire,
	executeQuickPrompt,
	matchPromptsForNote,
	promptMatchesTags,
	quickPromptButtonDisabled,
} from "../quick-prompts-logic";
import type { QuickPrompt, QuickPromptFileInput } from "../../types/quick-prompt";

describe("quick-prompts-logic", () => {
	// ========================================================================
	// T01 — Parse a prompt note
	// ========================================================================
	describe("T01: parse a prompt note", () => {
		it("strips the leading frontmatter block, leaving the body", () => {
			const raw =
				'---\ndescription: "🗓️ Debrief meeting"\n---\nDebrief this meeting.';
			expect(stripFrontmatter(raw)).toBe("Debrief this meeting.");
		});

		it("returns body verbatim when there is no frontmatter", () => {
			expect(stripFrontmatter("Just a body, no frontmatter.")).toBe(
				"Just a body, no frontmatter.",
			);
		});

		it("label = description (emoji preserved), body carried through", () => {
			const prompt = buildQuickPrompt({
				path: "Quick Prompts/Debrief.md",
				basename: "Debrief",
				frontmatter: { description: "🗓️ Debrief meeting" },
				body: "Debrief this meeting.",
			});
			expect(prompt.label).toBe("🗓️ Debrief meeting");
			expect(prompt.body).toBe("Debrief this meeting.");
			expect(prompt.usesSelection).toBe(false);
		});
	});

	// ========================================================================
	// T02 — Label fallback chain
	// ========================================================================
	describe("T02: label fallback chain description → name → title → basename", () => {
		it("uses name when description is absent", () => {
			expect(deriveLabel({ name: "Sync opps" }, "file-base")).toBe(
				"Sync opps",
			);
		});
		it("uses title when description and name are absent", () => {
			expect(deriveLabel({ title: "Daily brief" }, "file-base")).toBe(
				"Daily brief",
			);
		});
		it("falls back to basename when no label field is present", () => {
			expect(deriveLabel(null, "My Prompt")).toBe("My Prompt");
			expect(deriveLabel({}, "My Prompt")).toBe("My Prompt");
		});
		it("ignores empty/whitespace label fields", () => {
			expect(deriveLabel({ description: "   ", name: "Real" }, "b")).toBe(
				"Real",
			);
		});
	});

	// ========================================================================
	// T03 — Optional fields parsed-and-carried (inert in core)
	// ========================================================================
	describe("T03: optional fields parsed-and-carried", () => {
		it("carries tags (array), agent, mode, newTab", () => {
			const prompt = buildQuickPrompt({
				path: "Quick Prompts/Debrief.md",
				basename: "Debrief",
				frontmatter: {
					description: "Debrief",
					tags: ["NoteType/MeetingNote"],
					agent: "kiro-cli",
					mode: "default",
					newTab: true,
				},
				body: "x",
			});
			expect(prompt.tags).toEqual(["NoteType/MeetingNote"]);
			expect(prompt.agent).toBe("kiro-cli");
			expect(prompt.mode).toBe("default");
			expect(prompt.newTab).toBe(true);
		});
		it("normalizes a single-string tags value to an array", () => {
			const prompt = buildQuickPrompt({
				path: "Quick Prompts/x.md",
				basename: "x",
				frontmatter: { tags: "NoteType/DailyNote" },
				body: "x",
			});
			expect(prompt.tags).toEqual(["NoteType/DailyNote"]);
		});
		it("leaves optional fields undefined when absent; newTab only true when literal true", () => {
			const prompt = buildQuickPrompt({
				path: "Quick Prompts/x.md",
				basename: "x",
				frontmatter: { description: "x", newTab: false },
				body: "x",
			});
			expect(prompt.tags).toBeUndefined();
			expect(prompt.agent).toBeUndefined();
			expect(prompt.mode).toBeUndefined();
			expect(prompt.newTab).toBe(false);
		});
	});

	// ========================================================================
	// T04 — Folder scoping
	// ========================================================================
	describe("T04: isQuickPromptFile scopes to the configured folder", () => {
		it("matches .md directly under the folder", () => {
			expect(isQuickPromptFile("Quick Prompts/Debrief.md", "Quick Prompts")).toBe(true);
		});
		it("matches nested .md inside the folder", () => {
			expect(isQuickPromptFile("Quick Prompts/sub/Deep.md", "Quick Prompts")).toBe(true);
		});
		it("rejects files outside the folder", () => {
			expect(isQuickPromptFile("Other/z.md", "Quick Prompts")).toBe(false);
		});
		it("is boundary-safe (no prefix-collision)", () => {
			expect(isQuickPromptFile("Quick PromptsX/z.md", "Quick Prompts")).toBe(false);
		});
		it("rejects non-markdown files", () => {
			expect(isQuickPromptFile("Quick Prompts/note.txt", "Quick Prompts")).toBe(false);
		});
		it("tolerates a trailing slash in the configured folder", () => {
			expect(isQuickPromptFile("Quick Prompts/x.md", "Quick Prompts/")).toBe(true);
		});
	});

	// ========================================================================
	// T06 — Stable filename-derived id
	// ========================================================================
	describe("T06: stable filename-derived id", () => {
		it("slug is deterministic for a given basename", () => {
			expect(slugifyPromptId("Debrief Meeting")).toBe("debrief-meeting");
			expect(slugifyPromptId("Debrief Meeting")).toBe(
				slugifyPromptId("Debrief Meeting"),
			);
		});
		it("collapses symbols/spaces and trims hyphens", () => {
			expect(slugifyPromptId("  Get latest!! ")).toBe("get-latest");
		});
		it("falls back to 'untitled' for symbol-only names", () => {
			expect(slugifyPromptId("***")).toBe("untitled");
		});
		it("a rename yields a different (new-name) id", () => {
			const a = buildQuickPrompt(fileInput({ basename: "Old Name" }));
			const b = buildQuickPrompt(fileInput({ basename: "New Name" }));
			expect(a.id).toBe("old-name");
			expect(b.id).toBe("new-name");
			expect(a.id).not.toBe(b.id);
		});
	});

	// ========================================================================
	// T07 — Placeholder resolution
	// ========================================================================
	describe("T07: resolvePromptText", () => {
		it("substitutes {{selection}} with the selection text", () => {
			expect(resolvePromptText("Summarize:\n\n{{selection}}", "foo")).toBe(
				"Summarize:\n\nfoo",
			);
		});
		it("returns a no-token body verbatim", () => {
			expect(resolvePromptText("No placeholder here", "foo")).toBe(
				"No placeholder here",
			);
		});
		it("replaces all occurrences", () => {
			expect(resolvePromptText("{{selection}} and {{selection}}", "x")).toBe(
				"x and x",
			);
		});
		it("resolves to empty string when selection is null", () => {
			expect(resolvePromptText("a {{selection}} b", null)).toBe("a  b");
		});
	});

	// ========================================================================
	// T08–T13 — Decision engine
	// ========================================================================
	describe("decideQuickPromptAction — browser-true 2×2 (slice 1)", () => {
		const base = {
			openElsewhere: false,
			foreground: false,
			insert: false,
			defaultNewTab: false,
			composerHasText: false,
			isStreaming: false,
			isQueued: false,
			usesSelection: false,
			hasSelection: false,
		};

		it("S1-T1: plain, empty idle, this-tab default → fire", () => {
			expect(decideQuickPromptAction(base)).toEqual({ action: "fire" });
		});

		it("S1-T2: openElsewhere (⌘) → new-tab background, bypasses the current-tab guard", () => {
			expect(
				decideQuickPromptAction({
					...base,
					openElsewhere: true,
					composerHasText: true,
					isStreaming: true,
					isQueued: true,
				}),
			).toEqual({ action: "new-tab", send: true, foreground: false });
		});

		it("S1-T3: openElsewhere + foreground (⌘⇧) → new-tab foreground", () => {
			expect(
				decideQuickPromptAction({
					...base,
					openElsewhere: true,
					foreground: true,
				}),
			).toEqual({ action: "new-tab", send: true, foreground: true });
		});

		it("S1-T4: defaultNewTab plain click → new-tab FOREGROUND (target=_blank analogue)", () => {
			expect(
				decideQuickPromptAction({ ...base, defaultNewTab: true }),
			).toEqual({ action: "new-tab", send: true, foreground: true });
		});

		it("S1-T5: defaultNewTab + ⌘ → background; defaultNewTab + ⌘⇧ → foreground", () => {
			expect(
				decideQuickPromptAction({
					...base,
					defaultNewTab: true,
					openElsewhere: true,
				}),
			).toEqual({ action: "new-tab", send: true, foreground: false });
			expect(
				decideQuickPromptAction({
					...base,
					defaultNewTab: true,
					openElsewhere: true,
					foreground: true,
				}),
			).toEqual({ action: "new-tab", send: true, foreground: true });
		});

		it("S1-T6: insert (⌥), this tab, idle or streaming → insert", () => {
			expect(
				decideQuickPromptAction({ ...base, insert: true }),
			).toEqual({ action: "insert" });
			expect(
				decideQuickPromptAction({
					...base,
					insert: true,
					isStreaming: true,
				}),
			).toEqual({ action: "insert" });
		});

		it("S1-T7: bare foreground (⇧, no ⌘) is inert → fire (regression: ⇧ no longer inserts)", () => {
			expect(
				decideQuickPromptAction({ ...base, foreground: true }),
			).toEqual({ action: "fire" });
		});

		it("S1-T8: new-tab + insert (⌥) → seed (send:false), foreground per ⇧", () => {
			expect(
				decideQuickPromptAction({
					...base,
					defaultNewTab: true,
					insert: true,
				}),
			).toEqual({ action: "new-tab", send: false, foreground: true });
		});

		it("S1-T9: openElsewhere + insert (⌘⌥) → new-tab seed, background", () => {
			expect(
				decideQuickPromptAction({
					...base,
					openElsewhere: true,
					insert: true,
				}),
			).toEqual({ action: "new-tab", send: false, foreground: false });
		});

		it("S1-T10: {{selection}} no selection → this-tab insert(no-selection); new-tab → seed(no-selection)", () => {
			expect(
				decideQuickPromptAction({
					...base,
					usesSelection: true,
					hasSelection: false,
				}),
			).toEqual({ action: "insert", reason: "no-selection" });
			expect(
				decideQuickPromptAction({
					...base,
					usesSelection: true,
					hasSelection: true,
				}),
			).toEqual({ action: "fire" });
			expect(
				decideQuickPromptAction({
					...base,
					defaultNewTab: true,
					usesSelection: true,
					hasSelection: false,
				}),
			).toEqual({
				action: "new-tab",
				send: false,
				foreground: true,
				reason: "no-selection",
			});
		});

		it("S1-T11: queued, this tab → disabled (plain or ⌥); new-tab bypasses while queued", () => {
			expect(
				decideQuickPromptAction({ ...base, isQueued: true }),
			).toEqual({ action: "disabled" });
			expect(
				decideQuickPromptAction({
					...base,
					isQueued: true,
					insert: true,
				}),
			).toEqual({ action: "disabled" });
			expect(
				decideQuickPromptAction({
					...base,
					isQueued: true,
					openElsewhere: true,
				}),
			).toEqual({ action: "new-tab", send: true, foreground: false });
		});

		it("S1-T12: unsent draft, this tab → insert(unsent-draft)", () => {
			expect(
				decideQuickPromptAction({ ...base, composerHasText: true }),
			).toEqual({ action: "insert", reason: "unsent-draft" });
		});

		it("S1-T13: empty composer, streaming, this tab → queue", () => {
			expect(
				decideQuickPromptAction({ ...base, isStreaming: true }),
			).toEqual({ action: "queue" });
		});

		it("S1-T14: regression — all-false gesture + this-tab default preserves the legacy matrix", () => {
			expect(decideQuickPromptAction(base)).toEqual({ action: "fire" });
			expect(
				decideQuickPromptAction({ ...base, isStreaming: true }),
			).toEqual({ action: "queue" });
			expect(
				decideQuickPromptAction({ ...base, composerHasText: true }),
			).toEqual({ action: "insert", reason: "unsent-draft" });
			expect(
				decideQuickPromptAction({ ...base, isQueued: true }),
			).toEqual({ action: "disabled" });
		});
	});

	// ========================================================================
	// T14 — Plan = decision + resolved text compose
	// ========================================================================
	describe("T14: planQuickPromptFire composes decision + resolution", () => {
		const idle = {
			openElsewhere: false,
			foreground: false,
			insert: false,
			composerHasText: false,
			isStreaming: false,
			isQueued: false,
		};
		it("{{selection}} prompt with a selection on an empty idle composer → fire with resolved text", () => {
			const plan = planQuickPromptFire(
				{ body: "Summarize:\n\n{{selection}}", usesSelection: true },
				{ ...idle, selectionText: "the selected text" },
			);
			expect(plan.action).toBe("fire");
			expect(plan.text).toBe("Summarize:\n\nthe selected text");
		});

		it("{{selection}} prompt with no selection → insert (no-selection)", () => {
			const plan = planQuickPromptFire(
				{ body: "{{selection}}", usesSelection: true },
				{ ...idle, selectionText: null },
			);
			expect(plan.action).toBe("insert");
			expect(plan.reason).toBe("no-selection");
		});

		it("plain prompt into a non-empty composer → insert (unsent-draft) with resolved text", () => {
			const plan = planQuickPromptFire(
				{ body: "Do the thing", usesSelection: false },
				{ ...idle, composerHasText: true, selectionText: null },
			);
			expect(plan.action).toBe("insert");
			expect(plan.reason).toBe("unsent-draft");
			expect(plan.text).toBe("Do the thing");
		});
	});
});

function fileInput(
	overrides: Partial<QuickPromptFileInput>,
): QuickPromptFileInput {
	return {
		path: `Quick Prompts/${overrides.basename ?? "x"}.md`,
		basename: "x",
		frontmatter: null,
		body: "body",
		...overrides,
	};
}

// ============================================================================
// T19/T20 — Slice 2: contextual chips matching + queued-disable
// ============================================================================
describe("quick-prompts-logic — slice 2 (chips)", () => {
	function p(overrides: Partial<QuickPrompt>): QuickPrompt {
		return {
			id: "id",
			label: "L",
			body: "b",
			path: "Quick Prompts/x.md",
			usesSelection: false,
			...overrides,
		};
	}

	describe("T19: promptMatchesTags / matchPromptsForNote", () => {
		it("untagged prompt always matches (globally-shown)", () => {
			expect(promptMatchesTags(undefined, [])).toBe(true);
			expect(promptMatchesTags([], ["NoteType/DailyNote"])).toBe(true);
		});
		it("tagged prompt matches on any exact tag", () => {
			expect(
				promptMatchesTags(["project", "NoteType/MeetingNote"], ["NoteType/MeetingNote"]),
			).toBe(true);
		});
		it("nested match: prompt tag NoteType matches note tag NoteType/DailyNote", () => {
			expect(promptMatchesTags(["NoteType"], ["NoteType/DailyNote"])).toBe(true);
		});
		it("is case-insensitive and tolerates a leading #", () => {
			expect(promptMatchesTags(["notetype"], ["#NoteType/DailyNote"])).toBe(true);
		});
		it("no match when tags disjoint", () => {
			expect(promptMatchesTags(["NoteType"], ["Project/Alpha"])).toBe(false);
		});
		it("matchPromptsForNote keeps untagged + tag-matched, drops the rest", () => {
			const prompts = [
				p({ id: "global", tags: undefined }),
				p({ id: "meeting", tags: ["NoteType/MeetingNote"] }),
				p({ id: "daily", tags: ["NoteType"] }),
				p({ id: "other", tags: ["Project/Alpha"] }),
			];
			const matched = matchPromptsForNote(prompts, ["NoteType/MeetingNote"]);
			expect(matched.map((m) => m.id)).toEqual(["global", "meeting", "daily"]);
		});
		it("empty matched set when no untagged and no tag match (⇒ no row)", () => {
			const prompts = [p({ id: "other", tags: ["Project/Alpha"] })];
			expect(matchPromptsForNote(prompts, ["NoteType/DailyNote"])).toEqual([]);
		});
	});

	describe("T20: quickPromptButtonDisabled", () => {
		it("current-tab prompt is disabled while queued", () => {
			expect(quickPromptButtonDisabled({ newTab: false }, true)).toBe(true);
			expect(quickPromptButtonDisabled({ newTab: undefined }, true)).toBe(true);
		});
		it("current-tab prompt is enabled when not queued", () => {
			expect(quickPromptButtonDisabled({ newTab: false }, false)).toBe(false);
		});
		it("newTab prompt is never disabled (stays live while queued)", () => {
			expect(quickPromptButtonDisabled({ newTab: true }, true)).toBe(false);
		});
	});
});

// ============================================================================
// T23–T28 — newTab slice: open-in-new-tab decision + dispatch
//
// A `newTab` prompt always spawns a fresh tab; it bypasses the current-tab
// guard entirely (never queue/insert/disabled because of current-tab state).
// Plain fire → send into the new tab; modifier or {{selection}}-with-no-
// selection → open the tab but only seed its composer (don't auto-send).
// See [[Agent Console Quick Prompts and Workflows]] § Fire target.
// ============================================================================
describe("quick-prompts-logic — new-tab + foreground (slice 1)", () => {
	const idle = {
		openElsewhere: false,
		foreground: false,
		insert: false,
		composerHasText: false,
		isStreaming: false,
		isQueued: false,
	};

	describe("S1-T8/T9/T15: planQuickPromptFire new-tab branches", () => {
		it("defaultNewTab plain → new-tab send foreground (target=_blank)", () => {
			const plan = planQuickPromptFire(
				{ body: "Kick off", usesSelection: false, newTab: true },
				{ ...idle, selectionText: null },
			);
			expect(plan).toMatchObject({
				action: "new-tab",
				send: true,
				foreground: true,
			});
		});
		it("⌘ background + {{selection}} → resolved text, send, background", () => {
			const plan = planQuickPromptFire(
				{ body: "S:\n\n{{selection}}", usesSelection: true, newTab: false },
				{ ...idle, openElsewhere: true, selectionText: "sel" },
			);
			expect(plan).toMatchObject({
				action: "new-tab",
				send: true,
				foreground: false,
			});
			expect(plan.text).toBe("S:\n\nsel");
		});
		it("new-tab + {{selection}} with no selection → seed (send:false), never send:true", () => {
			const plan = planQuickPromptFire(
				{ body: "{{selection}}", usesSelection: true, newTab: true },
				{ ...idle, selectionText: null },
			);
			expect(plan.action).toBe("new-tab");
			expect(plan.send).toBe(false);
			expect(plan.reason).toBe("no-selection");
		});
	});

	describe("S1-T15/T16: executeQuickPrompt dispatches new-tab with foreground + background toast", () => {
		function actions() {
			return {
				fireOrQueue: vi.fn(),
				insert: vi.fn(),
				notify: vi.fn(),
				openInNewTab: vi.fn(),
			};
		}

		it("defaultNewTab plain (foreground) → openInNewTab(send:true,foreground:true); NO toast", () => {
			const a = actions();
			executeQuickPrompt(
				{ body: "Kick", usesSelection: false, label: "Kick", newTab: true },
				{ ...idle, selectionText: null },
				a,
			);
			expect(a.openInNewTab).toHaveBeenCalledWith("Kick", {
				send: true,
				foreground: true,
			});
			expect(a.notify).not.toHaveBeenCalled();
			expect(a.fireOrQueue).not.toHaveBeenCalled();
		});

		it("⌘ background send → openInNewTab(...,foreground:false) + 'Started …' toast", () => {
			const a = actions();
			executeQuickPrompt(
				{ body: "Kick", usesSelection: false, label: "Kick", newTab: false },
				{ ...idle, openElsewhere: true, selectionText: null },
				a,
			);
			expect(a.openInNewTab).toHaveBeenCalledWith("Kick", {
				send: true,
				foreground: false,
			});
			expect(a.notify).toHaveBeenCalledWith('Started "Kick" in a new tab.');
		});

		it("⌘⌥ background seed → openInNewTab(send:false,foreground:false) + 'Opened … to edit' toast", () => {
			const a = actions();
			executeQuickPrompt(
				{ body: "Kick", usesSelection: false, label: "Kick", newTab: false },
				{ ...idle, openElsewhere: true, insert: true, selectionText: null },
				a,
			);
			expect(a.openInNewTab).toHaveBeenCalledWith("Kick", {
				send: false,
				foreground: false,
			});
			expect(a.notify).toHaveBeenCalledWith('Opened "Kick" in a new tab to edit.');
		});

		it("new-tab + {{selection}} no selection → seed + no-selection notice (not the seed toast)", () => {
			const a = actions();
			executeQuickPrompt(
				{ body: "S: {{selection}}", usesSelection: true, label: "Sum", newTab: true },
				{ ...idle, selectionText: null },
				a,
			);
			expect(a.openInNewTab).toHaveBeenCalledWith("S: ", {
				send: false,
				foreground: true,
			});
			expect(a.notify).toHaveBeenCalledWith(
				'"Sum" needs a selection — dropped into the composer instead.',
			);
		});
	});
});
