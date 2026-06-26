import { describe, it, expect } from "vitest";
import {
	buildSystemInstructions,
	TITLE_RUBRIC,
	type PreparePromptInput,
} from "../message-sender";

/**
 * S2 (F03) — title rubric injection gating.
 *
 * buildSystemInstructions returns the 3 Obsidian formatting hints on the
 * first message, and additionally the title rubric ONLY when
 * titleStrategy === 'agent-suggested'. The rubric never appears on a
 * non-first message regardless of strategy.
 */

const base: PreparePromptInput = {
	message: "git merge vs rebase",
	vaultBasePath: "/vault",
};

describe("buildSystemInstructions — title rubric gating (S2)", () => {
	it("returns nothing on a non-first message", () => {
		expect(
			buildSystemInstructions({ ...base, isFirstMessage: false }),
		).toEqual([]);
	});

	it("first message, no titleStrategy → 3 hints, no rubric (back-compat)", () => {
		const out = buildSystemInstructions({
			...base,
			isFirstMessage: true,
		});
		expect(out).toHaveLength(3);
		expect(out).not.toContain(TITLE_RUBRIC);
	});

	it("first message, prompt-derived → no rubric", () => {
		const out = buildSystemInstructions({
			...base,
			isFirstMessage: true,
			titleStrategy: "prompt-derived",
		});
		expect(out).not.toContain(TITLE_RUBRIC);
		expect(out).toHaveLength(3);
	});

	it("first message, agent-timestamp → no rubric", () => {
		const out = buildSystemInstructions({
			...base,
			isFirstMessage: true,
			titleStrategy: "agent-timestamp",
		});
		expect(out).not.toContain(TITLE_RUBRIC);
		expect(out).toHaveLength(3);
	});

	it("first message, agent-suggested → rubric appended", () => {
		const out = buildSystemInstructions({
			...base,
			isFirstMessage: true,
			titleStrategy: "agent-suggested",
		});
		expect(out).toHaveLength(4);
		expect(out).toContain(TITLE_RUBRIC);
	});

	it("agent-suggested but NOT first message → still nothing", () => {
		expect(
			buildSystemInstructions({
				...base,
				isFirstMessage: false,
				titleStrategy: "agent-suggested",
			}),
		).toEqual([]);
	});

	it("the rubric names the exact <title>…</title> marker the parser expects", () => {
		expect(TITLE_RUBRIC).toContain("<title>");
		expect(TITLE_RUBRIC).toContain("</title>");
	});
});
