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
	extractPromptBody,
	decideQuickPromptAction,
	planQuickPromptFire,
	executeQuickPrompt,
	matchPromptsForNote,
	parseShowWhen,
	propertyMatches,
	conditionMatches,
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
	buildCreatePromptRow,
	SELECTION_TOKEN,
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
		it("carries showWhen (parsed key=value), agent, mode, newTab", () => {
			const prompt = buildQuickPrompt({
				path: "Quick Prompts/Debrief.md",
				basename: "Debrief",
				frontmatter: {
					label: "Debrief",
					"show when": ["type=meeting", "tags=NoteType/MeetingNote"],
					agent: "kiro-cli",
					mode: "default",
					"open in new tab": true,
				},
				body: "x",
			});
			expect(prompt.showWhen).toEqual([
				{ key: "type", value: "meeting" },
				{ key: "tags", value: "NoteType/MeetingNote" },
			]);
			expect(prompt.agent).toBe("kiro-cli");
			expect(prompt.mode).toBe("default");
			expect(prompt.newTab).toBe(true);
		});
		it("normalizes a single-string `show when` value to one condition", () => {
			const prompt = buildQuickPrompt({
				path: "Quick Prompts/x.md",
				basename: "x",
				frontmatter: { "show when": "type=daily" },
				body: "x",
			});
			expect(prompt.showWhen).toEqual([{ key: "type", value: "daily" }]);
		});
		it("absent show when → []; newTab only true when literal true", () => {
			const prompt = buildQuickPrompt({
				path: "Quick Prompts/x.md",
				basename: "x",
				frontmatter: { label: "x", "open in new tab": false },
				body: "x",
			});
			expect(prompt.showWhen).toEqual([]);
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
describe("quick-prompts-logic — show-when matching + chip visibility", () => {
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
	const note = (
		tags: string[],
		frontmatter: Record<string, unknown> | null = null,
	) => ({ tags, frontmatter });

	describe("S2-T1: parse the `always show` checkbox", () => {
		it("true when `always show: true`", () => {
			expect(buildQuickPrompt(fileInput({ "always show": true })).alwaysShow).toBe(true);
		});
		it("falsy when absent or false", () => {
			expect(buildQuickPrompt(fileInput(null)).alwaysShow).toBeFalsy();
			expect(buildQuickPrompt(fileInput({ "always show": false })).alwaysShow).toBeFalsy();
		});
	});

	describe("SW-T1: parseShowWhen — List/string of key=value, split on first =", () => {
		it("parses a List into conditions", () => {
			expect(parseShowWhen(["type=meeting", "status=open"])).toEqual([
				{ key: "type", value: "meeting" },
				{ key: "status", value: "open" },
			]);
		});
		it("parses a single string", () => {
			expect(parseShowWhen("type=meeting")).toEqual([
				{ key: "type", value: "meeting" },
			]);
		});
		it("splits on the FIRST = only (value may contain = or [[ ]])", () => {
			expect(parseShowWhen(["initiatives=[[TCOM]]"])).toEqual([
				{ key: "initiatives", value: "[[TCOM]]" },
			]);
			expect(parseShowWhen(["expr=a=b"])).toEqual([
				{ key: "expr", value: "a=b" },
			]);
		});
		it("trims keys and values", () => {
			expect(parseShowWhen([" type = meeting "])).toEqual([
				{ key: "type", value: "meeting" },
			]);
		});
		it("drops items with no = or an empty key", () => {
			expect(parseShowWhen(["bogus", "=novalue", "type=ok"])).toEqual([
				{ key: "type", value: "ok" },
			]);
		});
		it("buildQuickPrompt carries showWhen; legacy tags/show-on-tags keys ignored", () => {
			expect(
				buildQuickPrompt(fileInput({ "show when": ["type=meeting"] })).showWhen,
			).toEqual([{ key: "type", value: "meeting" }]);
			expect(
				buildQuickPrompt(fileInput({ "show on tags": ["x"] })).showWhen,
			).toEqual([]);
			expect(buildQuickPrompt(fileInput({ tags: ["x"] })).showWhen).toEqual([]);
		});
	});

	describe("SW-T2: missing/empty show when → [] (search-only)", () => {
		it("absent → []", () => {
			expect(buildQuickPrompt(fileInput(null)).showWhen).toEqual([]);
			expect(buildQuickPrompt(fileInput({ label: "x" })).showWhen).toEqual([]);
		});
		it("empty value → []", () => {
			expect(parseShowWhen([])).toEqual([]);
			expect(parseShowWhen("")).toEqual([]);
			expect(parseShowWhen(undefined)).toEqual([]);
		});
	});

	describe("S2-T3: tagsMatch — empty scope matches NOTHING; nested; #/case tolerant", () => {
		it("undefined / empty prompt scope → false", () => {
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
		it("no match when disjoint", () => {
			expect(tagsMatch(["NoteType"], ["Project/Alpha"])).toBe(false);
		});
	});

	describe("SW-T3: propertyMatches — equality (case-insensitive, trimmed)", () => {
		it("scalar equality", () => {
			expect(propertyMatches("meeting", "meeting")).toBe(true);
			expect(propertyMatches("bug", "meeting")).toBe(false);
		});
		it("case-insensitive + trimmed", () => {
			expect(propertyMatches(" Meeting ", "meeting")).toBe(true);
		});
		it("number / boolean coerced to string", () => {
			expect(propertyMatches(2026, "2026")).toBe(true);
			expect(propertyMatches(true, "true")).toBe(true);
		});
		it("null / undefined never matches", () => {
			expect(propertyMatches(undefined, "x")).toBe(false);
			expect(propertyMatches(null, "x")).toBe(false);
		});
	});

	describe("SW-T4: propertyMatches — list-membership", () => {
		it("matches when any list item equals the value", () => {
			expect(propertyMatches(["[[TCOM]]", "[[Other]]"], "[[TCOM]]")).toBe(true);
			expect(propertyMatches(["a", "b"], "c")).toBe(false);
		});
	});

	describe("SW-T5: conditionMatches — tags routes to tagsMatch, else property", () => {
		it("tags key uses nested tag matching", () => {
			expect(
				conditionMatches({ key: "tags", value: "NoteType" }, note(["NoteType/DailyNote"])),
			).toBe(true);
			expect(
				conditionMatches({ key: "tags", value: "NoteType" }, note(["Project/Alpha"])),
			).toBe(false);
		});
		it("non-tags key matches frontmatter equality / membership", () => {
			expect(
				conditionMatches({ key: "type", value: "meeting" }, note([], { type: "meeting" })),
			).toBe(true);
			expect(
				conditionMatches(
					{ key: "initiatives", value: "[[TCOM]]" },
					note([], { initiatives: ["[[TCOM]]"] }),
				),
			).toBe(true);
			expect(
				conditionMatches({ key: "type", value: "meeting" }, note([], { type: "bug" })),
			).toBe(false);
			expect(
				conditionMatches({ key: "type", value: "meeting" }, note([], null)),
			).toBe(false);
		});
	});

	describe("S2-T4 / SW-T7: promptInRestingRow — alwaysShow ∪ all-conditions-match", () => {
		it("alwaysShow → true regardless of conditions", () => {
			expect(promptInRestingRow(p({ alwaysShow: true }), note([], null))).toBe(true);
			expect(promptInRestingRow(p({ alwaysShow: true }), note(["Project/Alpha"]))).toBe(true);
		});
		it("show-when matching the note → true (property)", () => {
			expect(
				promptInRestingRow(
					p({ showWhen: [{ key: "type", value: "meeting" }] }),
					note([], { type: "meeting" }),
				),
			).toBe(true);
		});
		it("show-when matching the note → true (tags key)", () => {
			expect(
				promptInRestingRow(
					p({ showWhen: [{ key: "tags", value: "NoteType" }] }),
					note(["NoteType/DailyNote"]),
				),
			).toBe(true);
		});
		it("show-when not matching → false", () => {
			expect(
				promptInRestingRow(
					p({ showWhen: [{ key: "type", value: "meeting" }] }),
					note([], { type: "bug" }),
				),
			).toBe(false);
		});
		it("neither alwaysShow nor matching showWhen → false (search-only)", () => {
			expect(
				promptInRestingRow(p({}), note(["NoteType/DailyNote"], { type: "meeting" })),
			).toBe(false);
			expect(
				promptInRestingRow(p({ showWhen: [] }), note([], { type: "meeting" })),
			).toBe(false);
		});
	});

	describe("SW-T6: promptInRestingRow — AND within show-when", () => {
		const prompt = p({
			showWhen: [
				{ key: "type", value: "feature" },
				{ key: "status", value: "open" },
			],
		});
		it("true only when ALL conditions match", () => {
			expect(promptInRestingRow(prompt, note([], { type: "feature", status: "open" }))).toBe(true);
			expect(promptInRestingRow(prompt, note([], { type: "feature", status: "shipped" }))).toBe(false);
			expect(promptInRestingRow(prompt, note([], { type: "bug", status: "open" }))).toBe(false);
		});
	});

	describe("S2-T5: matchPromptsForNote — always-show ∪ show-when-matched", () => {
		it("keeps always-show + matched; drops search-only / non-matching", () => {
			const prompts = [
				p({ id: "global", alwaysShow: true }),
				p({ id: "meeting", showWhen: [{ key: "type", value: "meeting" }] }),
				p({ id: "daily", showWhen: [{ key: "tags", value: "NoteType" }] }),
				p({ id: "bug", showWhen: [{ key: "type", value: "bug" }] }),
				p({ id: "quiet" }),
			];
			const matched = matchPromptsForNote(
				prompts,
				note(["NoteType/DailyNote"], { type: "meeting" }),
			);
			expect(matched.map((m) => m.id)).toEqual(["global", "meeting", "daily"]);
		});
		it("empty resting set ⇒ no row", () => {
			const prompts = [
				p({ id: "quiet" }),
				p({ id: "bug", showWhen: [{ key: "type", value: "bug" }] }),
			];
			expect(matchPromptsForNote(prompts, note([], { type: "meeting" }))).toEqual([]);
		});
	});

	describe("S2-T6: alwaysShow + showWhen both set → resting on every note", () => {
		const prompt = p({
			alwaysShow: true,
			showWhen: [{ key: "type", value: "meeting" }],
		});
		it("shows even when conditions do NOT match (alwaysShow wins)", () => {
			expect(promptInRestingRow(prompt, note([], { type: "bug" }))).toBe(true);
			expect(matchPromptsForNote([prompt], note([], { type: "bug" }))).toHaveLength(1);
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
		it("QP-I15: keeps spaces in the query — '!foo ' → 'foo '", () => {
			expect(parseQuickPromptTrigger("!foo ")).toBe("foo ");
		});
		it("QP-I15: multi-word query — '!Daily brief' → 'Daily brief'", () => {
			expect(parseQuickPromptTrigger("!Daily brief")).toBe("Daily brief");
		});
		it("QP-I15: query still terminates at a second ! — '!a !b' → null", () => {
			expect(parseQuickPromptTrigger("!a !b")).toBeNull();
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
		it("QP-I15: strips a multi-word token — '!Daily brief' → ''", () => {
			expect(stripQuickPromptTrigger("!Daily brief", 12)).toBe("");
		});
		it("QP-I15: preserves the line before a multi-word token", () => {
			expect(stripQuickPromptTrigger("hey\n!Daily brief", 16)).toBe(
				"hey\n",
			);
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
		it("seeds label + unchecked checkboxes + empty show-on-tags, placeholder body", () => {
			const note = buildNewPromptNote({ label: "Daily brief" });
			expect(note.frontmatter).toEqual({
				label: "Daily brief",
				"open in new tab": false,
				"always show": false,
				"show when": [],
			});
			expect(note.body).toBe(NEW_PROMPT_BODY_PLACEHOLDER);
		});
		it("QP-I08: blank label is prefilled with 'New prompt' (no empty label)", () => {
			expect(buildNewPromptNote({ label: "" }).frontmatter.label).toBe(
				"New prompt",
			);
			expect(buildNewPromptNote({ label: "   " }).frontmatter.label).toBe(
				"New prompt",
			);
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

	describe("QP-I12: prompt/help separator — a selection token below --- is ignored", () => {
		it("the PROMPT part (above ---) of the placeholder has no live selection token", () => {
			expect(extractPromptBody(NEW_PROMPT_BODY_PLACEHOLDER)).not.toContain(
				SELECTION_TOKEN,
			);
		});
		it("a freshly-created prompt fires normally (a token in the help below --- does not count)", () => {
			const p = buildQuickPrompt({
				path: "Quick Prompts/New prompt.md",
				basename: "New prompt",
				frontmatter: { label: "New prompt" },
				body: NEW_PROMPT_BODY_PLACEHOLDER,
			});
			expect(p.usesSelection).toBe(false);
			expect(p.body).toBe("Write your prompt here.");
		});
	});

	describe("S4-T4/QP-I10/I11: buildCreatePromptRow — always offered; composer-aware", () => {
		const cqp = (q: string) => ({
			kind: "create-prompt",
			query: q,
			label: `Create quick prompt "${q}"`,
		});
		it("non-blank query, no draft → Create quick prompt row whether or not matches exist", () => {
			expect(buildCreatePromptRow("  daily  ", 0, false)).toEqual(
				cqp("daily"),
			);
			expect(buildCreatePromptRow("daily", 5, false)).toEqual(cqp("daily"));
		});
		it("QP-I07: blank query + zero prompts, no draft → 'Create your first quick prompt'", () => {
			const onramp = {
				kind: "create-prompt",
				query: "",
				label: "Create your first quick prompt",
			};
			expect(buildCreatePromptRow("   ", 0, false)).toEqual(onramp);
			expect(buildCreatePromptRow("", 0, false)).toEqual(onramp);
		});
		it("QP-I10: blank query + prompts exist, no draft → 'Create a quick prompt'", () => {
			expect(buildCreatePromptRow("", 3, false)).toEqual({
				kind: "create-prompt",
				query: "",
				label: "Create a quick prompt",
			});
		});
		it("QP-I11: composer has a draft → 'from this message' + fromComposer flag", () => {
			expect(buildCreatePromptRow("", 0, true)).toEqual({
				kind: "create-prompt",
				query: "",
				label: "Create quick prompt from this message",
				fromComposer: true,
			});
			expect(buildCreatePromptRow("foo", 5, true)).toEqual({
				kind: "create-prompt",
				query: "foo",
				label: "Create quick prompt from this message",
				fromComposer: true,
			});
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

describe("quick-prompts-logic — prompt/help separator (---)", () => {
	it("SEP-T1: prompt = text above the first ---; below ignored", () => {
		expect(extractPromptBody("Do the thing.\n\n---\n\nhelp & notes")).toBe(
			"Do the thing.",
		);
	});
	it("SEP-T2: no separator → whole body (trimmed)", () => {
		expect(extractPromptBody("  Just a prompt.  ")).toBe("Just a prompt.");
		expect(extractPromptBody("a\nb\nc")).toBe("a\nb\nc");
	});
	it("SEP-T3: only the prompt part counts for {{selection}} + body", () => {
		const above = buildQuickPrompt({
			path: "Quick Prompts/a.md",
			basename: "a",
			frontmatter: null,
			body: "Summarize {{selection}}\n---\nhelp",
		});
		const below = buildQuickPrompt({
			path: "Quick Prompts/b.md",
			basename: "b",
			frontmatter: null,
			body: "Summarize this\n---\nuse {{selection}} here",
		});
		expect(above.usesSelection).toBe(true);
		expect(above.body).toBe("Summarize {{selection}}");
		expect(below.usesSelection).toBe(false);
		expect(below.body).toBe("Summarize this");
	});
	it("SEP-T4: matches 3+ dashes", () => {
		expect(extractPromptBody("a\n----\nb")).toBe("a");
	});
});
