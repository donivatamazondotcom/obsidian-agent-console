import { describe, it, expect } from "vitest";
import {
	buildSystemInstructions,
	buildTitleRubric,
	TITLE_RUBRIC,
	type PreparePromptInput,
} from "../message-sender";

/**
 * S2 (F03) + I111 — title rubric gating and placement.
 *
 * buildSystemInstructions returns ONLY the 3 Obsidian formatting hints on the
 * first message (they lead the prompt). The title rubric is produced separately
 * by buildTitleRubric and positioned immediately before the user message
 * (I111), firing ONLY on the first message under `agent-suggested`.
 */

const base: PreparePromptInput = {
	message: "git merge vs rebase",
	vaultBasePath: "/vault",
};

describe("buildSystemInstructions — formatting hints only (S2/I111)", () => {
	it("returns nothing on a non-first message", () => {
		expect(
			buildSystemInstructions({ ...base, isFirstMessage: false }),
		).toEqual([]);
	});

	it("first message → exactly the 3 hints, never the rubric", () => {
		const out = buildSystemInstructions({ ...base, isFirstMessage: true });
		expect(out).toHaveLength(3);
		expect(out).not.toContain(TITLE_RUBRIC);
	});

	it("first message, agent-suggested → still only the 3 hints (rubric is separate now)", () => {
		const out = buildSystemInstructions({
			...base,
			isFirstMessage: true,
			titleStrategy: "agent-suggested",
		});
		expect(out).toHaveLength(3);
		expect(out).not.toContain(TITLE_RUBRIC);
	});
});

describe("buildTitleRubric — gating (S2/I111)", () => {
	it("returns null on a non-first message", () => {
		expect(
			buildTitleRubric({ ...base, isFirstMessage: false }),
		).toBeNull();
		expect(
			buildTitleRubric({
				...base,
				isFirstMessage: false,
				titleStrategy: "agent-suggested",
			}),
		).toBeNull();
	});

	it("first message, no titleStrategy → null (back-compat)", () => {
		expect(buildTitleRubric({ ...base, isFirstMessage: true })).toBeNull();
	});

	it("first message, prompt-derived → null", () => {
		expect(
			buildTitleRubric({
				...base,
				isFirstMessage: true,
				titleStrategy: "prompt-derived",
			}),
		).toBeNull();
	});

	it("first message, agent-timestamp → null", () => {
		expect(
			buildTitleRubric({
				...base,
				isFirstMessage: true,
				titleStrategy: "agent-timestamp",
			}),
		).toBeNull();
	});

	it("first message, agent-suggested → the rubric", () => {
		expect(
			buildTitleRubric({
				...base,
				isFirstMessage: true,
				titleStrategy: "agent-suggested",
			}),
		).toBe(TITLE_RUBRIC);
	});

	it("the rubric names the exact <title>…</title> marker the parser expects", () => {
		expect(TITLE_RUBRIC).toContain("<title>");
		expect(TITLE_RUBRIC).toContain("</title>");
	});
});
