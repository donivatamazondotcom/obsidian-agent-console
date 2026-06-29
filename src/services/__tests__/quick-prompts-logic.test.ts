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
	tagsMatch,
	promptInRestingRow,
	quickPromptButtonDisabled,
	capRestingChips,
	parseQuickPromptTrigger,
	stripQuickPromptTrigger,
	rankLauncherPrompts,
	deriveFilenameBase,
	disambiguateFilename,
	buildNewPromptNote,
	deriveLabelFromComposer,
	decideCreateOnNoMatch,
	NEW_PROMPT_BODY_PLACEHOLDER,
} from "../quick-prompts-logic";
import type { QuickPrompt, QuickPromptFileInput } from "../../types/quick-prompt";

describe("quick-prompts-logic", () => {
	// ========================================================================
	// T01 — Parse a prompt note
	// ========================================================================
	describe("T01: parse a prompt note", () => {
		it("strips the leading frontmatter block, leaving the body", () => {
			const raw =
				'---\nlabel: "🗓️ Debrief meeting"\n---\nDebrief this meeting.';
			expect(stripFrontmatter(raw)).toBe("Debrief this meeting.");
		});

		it("returns body verbatim when there is no frontmatter", () => {
			expect(stripFrontmatter("Just a body, no frontmatter.")).toBe(
				"Just a body, no frontmatter.",
			);
		});

		it("label = label field (emoji preserved), body carried through", () => {
			const prompt = buildQuickPrompt({
				path: "Quick Prompts/Debrief.md",
				basename: "Debrief",
				frontmatter: { label: "🗓️ Debrief meeting" },
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
	describe("T02: label fallback chain label → name → title → basename", () => {
		it("uses name when label is absent", () => {
			expect(deriveLabel({ name: "Sync opps" }, "file-base")).toBe(
				"Sync opps",
			);
		});
		it("uses title when label and name are absent", () => {
			expect(deriveLabel({ title: "Daily brief" }, "file-base")).toBe(
				"Daily brief",
			);
		});
		it("falls back to basename when no label field is present", () => {
			expect(deriveLabel(null, "My Prompt")).toBe("My Prompt");
			expect(deriveLabel({}, "My Prompt")).toBe("My Prompt");
		});
		it("ignores empty/whitespace label fields", () => {
			expect(deriveLabel({ label: "   ", name: "Real" }, "b")).toBe(
				"Real",
			);
		});
	});

	// ========================================================================
	// T03 — Optional fields parsed-and-carried (inert in core)
	// ========================================================================
	describe("T03: optional fields parsed-and-carried", () => {
		it("carries showOnTags (array), agent, mode, newTab", () => {
			const prompt = buildQuickPrompt({
				path: "Quick Prompts/Debrief.md",
				basename: "Debrief",
				frontmatter: {
					label: "Debrief",
					"show on tags": ["NoteType/MeetingNote"],
					agent: "kiro-cli",
					mode: "default",
					"open in new tab": true,
				},
				body: "x",
			});
			expect(prompt.showOnTags).toEqual(["NoteType/MeetingNote"]);
			expect(prompt.agent).toBe("kiro-cli");
			expect(prompt.mode).toBe("default");
			expect(prompt.newTab).toBe(true);
		});
		it("normalizes a single-string `show on tags` value to an array", () => {
			const prompt = buildQuickPrompt({
				path: "Quick Prompts/x.md",
				basename: "x",
				frontmatter: { "show on tags": "NoteType/DailyNote" },
				body: "x",
			});
			expect(prompt.showOnTags).toEqual(["NoteType/DailyNote"]);
		});
		it("leaves optional fields undefined when absent; newTab only true when literal true", () => {
			const prompt = buildQuickPrompt({
				path: "Quick Prompts/x.md",
				basename: "x",
				frontmatter: { label: "x", "open in new tab": false },
				body: "x",
			});
			expect(prompt.showOnTags).toBeUndefined();
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
// S2-T1..T6 / T20 — Slice 2: chip visibility (D6) + queued-disable
//
// Resting chip row = `always show` ∪ tag-matched. Untagged + un-`always show`
// prompts are SEARCH-ONLY (still in the picker, never in the resting row).
// See [[Agent Console Quick Prompts UX Refinement]] § Chip visibility (D6).
// ============================================================================
describe("quick-prompts-logic — slice 2 (chip visibility, D6)", () => {
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

	function fileInput(
		frontmatter: Record<string, unknown> | null,
	): QuickPromptFileInput {
		return {
			path: "Quick Prompts/x.md",
			basename: "x",
			frontmatter,
			body: "Body text",
		};
	}

	describe("S2-T1: parse the `always show` checkbox", () => {
		it("true when `always show: true`", () => {
			expect(buildQuickPrompt(fileInput({ "always show": true })).alwaysShow).toBe(
				true,
			);
		});
		it("falsy when absent or false", () => {
			expect(buildQuickPrompt(fileInput(null)).alwaysShow).toBeFalsy();
			expect(
				buildQuickPrompt(fileInput({ "always show": false })).alwaysShow,
			).toBeFalsy();
		});
	});

	describe("S2-T2: parse `show on tags` (array or single string); `tags` ignored", () => {
		it("array value", () => {
			expect(
				buildQuickPrompt(fileInput({ "show on tags": ["NoteType/MeetingNote"] }))
					.showOnTags,
			).toEqual(["NoteType/MeetingNote"]);
		});
		it("single string value", () => {
			expect(
				buildQuickPrompt(fileInput({ "show on tags": "project" })).showOnTags,
			).toEqual(["project"]);
		});
		it("the legacy `tags` key is NOT read into the scope (clean rename)", () => {
			expect(
				buildQuickPrompt(fileInput({ tags: ["project"] })).showOnTags,
			).toBeUndefined();
		});
	});

	describe("S2-T3: tagsMatch — empty scope matches NOTHING (inverted contract)", () => {
		it("undefined / empty prompt scope → false (no longer always-true)", () => {
			expect(tagsMatch(undefined, ["NoteType/DailyNote"])).toBe(false);
			expect(tagsMatch([], ["NoteType/DailyNote"])).toBe(false);
		});
		it("matches on any exact tag", () => {
			expect(
				tagsMatch(["project", "NoteType/MeetingNote"], ["NoteType/MeetingNote"]),
			).toBe(true);
		});
		it("nested: scope NoteType matches note tag NoteType/DailyNote", () => {
			expect(tagsMatch(["NoteType"], ["NoteType/DailyNote"])).toBe(true);
		});
		it("is case-insensitive and tolerates a leading #", () => {
			expect(tagsMatch(["notetype"], ["#NoteType/DailyNote"])).toBe(true);
		});
		it("no match when scope and note tags are disjoint", () => {
			expect(tagsMatch(["NoteType"], ["Project/Alpha"])).toBe(false);
		});
	});

	describe("S2-T4: promptInRestingRow — alwaysShow ∪ tag-matched", () => {
		it("alwaysShow → true regardless of tags", () => {
			expect(promptInRestingRow(p({ alwaysShow: true }), [])).toBe(true);
			expect(
				promptInRestingRow(p({ alwaysShow: true }), ["Project/Alpha"]),
			).toBe(true);
		});
		it("showOnTags matching the note → true", () => {
			expect(
				promptInRestingRow(p({ showOnTags: ["NoteType"] }), [
					"NoteType/DailyNote",
				]),
			).toBe(true);
		});
		it("showOnTags not matching → false", () => {
			expect(
				promptInRestingRow(p({ showOnTags: ["NoteType"] }), ["Project/Alpha"]),
			).toBe(false);
		});
		it("neither alwaysShow nor showOnTags → false (search-only)", () => {
			expect(promptInRestingRow(p({}), ["NoteType/DailyNote"])).toBe(false);
		});
	});

	describe("S2-T5: matchPromptsForNote = always-show ∪ tag-matched (rewrite of T19)", () => {
		it("keeps always-show + tag-matched; drops untagged/un-always-show", () => {
			const prompts = [
				p({ id: "global", alwaysShow: true }),
				p({ id: "meeting", showOnTags: ["NoteType/MeetingNote"] }),
				p({ id: "daily", showOnTags: ["NoteType"] }),
				p({ id: "other", showOnTags: ["Project/Alpha"] }),
				p({ id: "quiet" }), // neither → search-only
			];
			const matched = matchPromptsForNote(prompts, ["NoteType/MeetingNote"]);
			expect(matched.map((m) => m.id)).toEqual(["global", "meeting", "daily"]);
		});
		it("empty resting set when only quiet/non-matching prompts (⇒ no row)", () => {
			const prompts = [
				p({ id: "quiet" }),
				p({ id: "other", showOnTags: ["Project/Alpha"] }),
			];
			expect(matchPromptsForNote(prompts, ["NoteType/DailyNote"])).toEqual([]);
		});
	});

	describe("S2-T6: alwaysShow + showOnTags both set → resting on every note", () => {
		const prompt = p({ alwaysShow: true, showOnTags: ["NoteType"] });
		it("shows even when the tag scope does NOT match (alwaysShow wins)", () => {
			expect(promptInRestingRow(prompt, ["Project/Alpha"])).toBe(true);
			expect(matchPromptsForNote([prompt], ["Project/Alpha"])).toHaveLength(1);
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

// ============================================================================
// S3-T1..T3 — Slice 3 (Option E): launcher pure helpers
//
// Borderless resting chips (count cap) + a composer `!`-trigger (token parse +
// strip) + the dropdown ranker. See [[Agent Console Quick Prompts UX
// Refinement]] § Next steps → slice 3 (Option E).
// ============================================================================
describe("quick-prompts-logic — slice 3 (launcher: chips + ! trigger)", () => {
	function p(id: string): QuickPrompt {
		return {
			id,
			label: id,
			body: "b",
			path: `Quick Prompts/${id}.md`,
			usesSelection: false,
		};
	}

	describe("S3-T1: capRestingChips — single-line count cap", () => {
		const five = [p("a"), p("b"), p("c"), p("d"), p("e")];
		it("under/equal cap → all shown, no overflow", () => {
			expect(capRestingChips(five.slice(0, 3), 4)).toEqual({
				shown: five.slice(0, 3),
				overflowCount: 0,
			});
			expect(capRestingChips(five.slice(0, 4), 4)).toEqual({
				shown: five.slice(0, 4),
				overflowCount: 0,
			});
		});
		it("over cap → first `max` shown + correct overflow count", () => {
			const r = capRestingChips(five, 3);
			expect(r.shown.map((x) => x.id)).toEqual(["a", "b", "c"]);
			expect(r.overflowCount).toBe(2);
		});
		it("max <= 0 disables the cap", () => {
			expect(capRestingChips(five, 0)).toEqual({
				shown: five,
				overflowCount: 0,
			});
		});
	});

	describe("S3-T2: parseQuickPromptTrigger — the ! token", () => {
		it("fires at line-start: !foo → foo", () => {
			expect(parseQuickPromptTrigger("!foo")).toBe("foo");
		});
		it("does NOT fire after a space mid-line: 'bar !foo' → null", () => {
			expect(parseQuickPromptTrigger("bar !foo")).toBeNull();
		});
		it("fires after a newline (multiline composer)", () => {
			expect(parseQuickPromptTrigger("line one\n!foo")).toBe("foo");
		});
		it("does NOT fire mid-word: foo!bar → null", () => {
			expect(parseQuickPromptTrigger("foo!bar")).toBeNull();
		});
		it("null when there is no ! token", () => {
			expect(parseQuickPromptTrigger("just typing")).toBeNull();
		});
		it("bare ! → empty query (show all)", () => {
			expect(parseQuickPromptTrigger("!")).toBe("");
		});
		it("closes once a space follows the query: '!foo ' → null", () => {
			expect(parseQuickPromptTrigger("!foo ")).toBeNull();
		});
	});

	describe("S3-T2b: stripQuickPromptTrigger — remove only the ! token", () => {
		it("clears a lone token", () => {
			expect(stripQuickPromptTrigger("!summ", 5)).toBe("");
		});
		it("preserves the line before the token (append-safe)", () => {
			expect(stripQuickPromptTrigger("hey\n!summ", 9)).toBe("hey\n");
		});
		it("no token → unchanged", () => {
			expect(stripQuickPromptTrigger("nothing here", 12)).toBe(
				"nothing here",
			);
		});
		it("keeps text after the caret", () => {
			expect(stripQuickPromptTrigger("!sum tail", 4)).toBe(" tail");
		});
	});

	describe("S3-T3: rankLauncherPrompts — empty → all; query → matched, ranked", () => {
		const prompts = [p("alpha"), p("beta"), p("gamma")];
		it("empty query → all prompts in stable order", () => {
			expect(rankLauncherPrompts(prompts, "").map((x) => x.id)).toEqual([
				"alpha",
				"beta",
				"gamma",
			]);
			expect(rankLauncherPrompts(prompts, "   ").map((x) => x.id)).toEqual([
				"alpha",
				"beta",
				"gamma",
			]);
		});
		it("with an injected scorer → only matched, sorted by score desc", () => {
			const scorer = (text: string) => {
				if (text === "alpha") return { score: 1 };
				if (text === "gamma") return { score: 5 };
				return null; // beta excluded
			};
			expect(
				rankLauncherPrompts(prompts, "a", scorer).map((x) => x.id),
			).toEqual(["gamma", "alpha"]);
		});
		it("substring fallback when no scorer is supplied", () => {
			expect(
				rankLauncherPrompts(prompts, "AL", undefined).map((x) => x.id),
			).toEqual(["alpha"]);
		});
	});
});

// ============================================================================
// S4-T1..T6 — Slice 4: creation flow (D4) pure helpers
//
// Filename derivation + collision disambiguation + templated-note builder +
// create-on-no-match decision + composer-label derivation. All pure; the file
// write + open is the service/UI layer (S4-T7/T8 svc; S4-T9 component;
// S4-T10..T12 human-smoke). See [[Agent Console Quick Prompts UX Refinement]]
// § Creating quick prompts (D4) + § Prior art + UX grounding.
// ============================================================================
describe("quick-prompts-logic — slice 4 (creation flow, D4)", () => {
	describe("S4-T1: deriveFilenameBase — strip illegal chars, keep emoji/spaces", () => {
		it("strips the Note-Refactor illegal set # : \\ / * ? \" < > |", () => {
			expect(deriveFilenameBase("Summarize: the #thing")).toBe(
				"Summarize the thing",
			);
			expect(deriveFilenameBase('a/b\\c:d*e?f"g<h>i|j')).toBe("abcdefghij");
		});
		it("preserves emoji and internal single spaces", () => {
			expect(deriveFilenameBase("🗓️ Daily brief")).toBe("🗓️ Daily brief");
		});
		it("collapses whitespace runs and trims", () => {
			expect(deriveFilenameBase("  Get    latest  ")).toBe("Get latest");
		});
		it("blank / symbol-only → 'New prompt'", () => {
			expect(deriveFilenameBase("   ")).toBe("New prompt");
			expect(deriveFilenameBase("///")).toBe("New prompt");
			expect(deriveFilenameBase("")).toBe("New prompt");
		});
	});

	describe("S4-T2: disambiguateFilename — never returns an existing name", () => {
		it("returns the desired name when free", () => {
			expect(disambiguateFilename("Daily brief", [])).toBe("Daily brief");
			expect(disambiguateFilename("Daily brief", ["Other"])).toBe(
				"Daily brief",
			);
		});
		it("appends ' 1', ' 2' … on collision (Obsidian convention)", () => {
			expect(disambiguateFilename("Daily brief", ["Daily brief"])).toBe(
				"Daily brief 1",
			);
			expect(
				disambiguateFilename("Daily brief", [
					"Daily brief",
					"Daily brief 1",
				]),
			).toBe("Daily brief 2");
		});
		it("is case-insensitive (macOS filesystem safety)", () => {
			expect(disambiguateFilename("Daily Brief", ["daily brief"])).toBe(
				"Daily Brief 1",
			);
		});
		it("never returns a name already in the existing set", () => {
			const existing = ["X", "X 1", "X 2"];
			const out = disambiguateFilename("X", existing);
			expect(existing.includes(out)).toBe(false);
			expect(out).toBe("X 3");
		});
	});

	describe("S4-T3: buildNewPromptNote — templated frontmatter + body", () => {
		it("seeds label + unchecked checkboxes, placeholder body when none given", () => {
			const note = buildNewPromptNote({ label: "Daily brief" });
			expect(note.frontmatter).toEqual({
				label: "Daily brief",
				"open in new tab": false,
				"always show": false,
			});
			expect(note.body).toBe(NEW_PROMPT_BODY_PLACEHOLDER);
		});
		it("preserves a captured body verbatim when provided", () => {
			const note = buildNewPromptNote({
				label: "X",
				body: "captured composer text",
			});
			expect(note.frontmatter.label).toBe("X");
			expect(note.body).toBe("captured composer text");
		});
		it("an empty/whitespace captured body falls back to the placeholder", () => {
			expect(buildNewPromptNote({ label: "X", body: "   " }).body).toBe(
				NEW_PROMPT_BODY_PLACEHOLDER,
			);
		});
	});

	describe("S4-T4: decideCreateOnNoMatch — only when zero matches + non-blank query (2a)", () => {
		it("zero matches + non-blank query → create row carrying the trimmed query", () => {
			expect(decideCreateOnNoMatch("  daily  ", 0)).toEqual({
				kind: "create-prompt",
				query: "daily",
				label: 'Create quick prompt "daily"',
			});
		});
		it("null when matches exist (Quick Switcher Enter-creates branch only)", () => {
			expect(decideCreateOnNoMatch("daily", 2)).toBeNull();
		});
		it("null for a blank query", () => {
			expect(decideCreateOnNoMatch("   ", 0)).toBeNull();
			expect(decideCreateOnNoMatch("", 0)).toBeNull();
		});
	});

	describe("S4-T6: deriveLabelFromComposer — first non-empty line, capped", () => {
		it("uses the first non-empty line, trimmed", () => {
			expect(deriveLabelFromComposer("Summarize this\n\nmore")).toBe(
				"Summarize this",
			);
			expect(deriveLabelFromComposer("\n\n  hi there  ")).toBe("hi there");
		});
		it("caps long first lines to 60 chars", () => {
			expect(deriveLabelFromComposer("a".repeat(80))).toHaveLength(60);
		});
		it("blank composer → 'New prompt'", () => {
			expect(deriveLabelFromComposer("   \n  ")).toBe("New prompt");
			expect(deriveLabelFromComposer("")).toBe("New prompt");
		});
	});
});
