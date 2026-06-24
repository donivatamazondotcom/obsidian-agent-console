import { describe, it, expect } from "vitest";
import { promptMatchesTags, matchingPrompts } from "../prompt-matching";
import type { PromptDefinition } from "../../types/prompt";

function prompt(tags: string[], path = "p.md"): PromptDefinition {
	return {
		path,
		name: path,
		description: path,
		prompt: "body",
		agent: "test-agent",
		tags,
	};
}

describe("promptMatchesTags", () => {
	it("an untagged prompt is global (matches any note)", () => {
		expect(promptMatchesTags(prompt([]), [])).toBe(true);
		expect(promptMatchesTags(prompt([]), ["#anything"])).toBe(true);
	});

	it("matches when the note carries ANY of the prompt's tags (OR)", () => {
		const p = prompt(["dailyNote", "meeting"]);
		expect(promptMatchesTags(p, ["#meeting"])).toBe(true);
		expect(promptMatchesTags(p, ["#dailyNote"])).toBe(true);
		expect(promptMatchesTags(p, ["#other"])).toBe(false);
	});

	it("is case-insensitive and ignores leading #", () => {
		const p = prompt(["DailyNote"]);
		expect(promptMatchesTags(p, ["dailynote"])).toBe(true);
		expect(promptMatchesTags(p, ["#DAILYNOTE"])).toBe(true);
	});

	it("a tagged prompt does not match a note with no tags", () => {
		expect(promptMatchesTags(prompt(["x"]), [])).toBe(false);
	});
});

describe("matchingPrompts", () => {
	it("filters to applicable prompts, preserving order", () => {
		const list = [
			prompt([], "global.md"),
			prompt(["meeting"], "meeting.md"),
			prompt(["daily"], "daily.md"),
		];
		const result = matchingPrompts(list, ["#meeting"]);
		expect(result.map((p) => p.path)).toEqual(["global.md", "meeting.md"]);
	});

	it("returns only global prompts when no note is active (empty tags)", () => {
		const list = [prompt([], "g.md"), prompt(["x"], "x.md")];
		expect(matchingPrompts(list, []).map((p) => p.path)).toEqual(["g.md"]);
	});
});
