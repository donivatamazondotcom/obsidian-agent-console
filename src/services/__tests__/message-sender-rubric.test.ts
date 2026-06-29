import { describe, it, expect } from "vitest";
import {
	buildObsidianSystemPrompt,
	buildTitleRubric,
	TITLE_RUBRIC,
	type PreparePromptInput,
} from "../message-sender";

/**
 * S2 (F03) + I111 — title rubric gating and placement.
 *
 * buildObsidianSystemPrompt returns the composed Obsidian host-context briefing
 * on the first message (it leads the prompt). The title rubric is produced separately
 * by buildTitleRubric and positioned immediately before the user message
 * (I111), firing ONLY on the first message under `agent-suggested`.
 */

const base: PreparePromptInput = {
	message: "git merge vs rebase",
	vaultBasePath: "/vault",
};

describe("buildObsidianSystemPrompt — composed briefing (slice 3)", () => {
	it("returns null on a non-first message", () => {
		expect(
			buildObsidianSystemPrompt({ ...base, isFirstMessage: false }),
		).toBeNull();
	});

	it("first message → the composed briefing, folding in the formatting hints, never the rubric", () => {
		const out = buildObsidianSystemPrompt({ ...base, isFirstMessage: true });
		expect(out).not.toBeNull();
		expect(out).not.toContain(TITLE_RUBRIC);
		expect(out).toContain("wikilink");
		expect(out).toContain("Markdown tables");
	});

	it("includes the vault-collaboration line when cwd defaults to the vault root", () => {
		const out = buildObsidianSystemPrompt({ ...base, isFirstMessage: true });
		expect(out).toContain("read and edit");
	});

	it("omits the vault-collaboration line, keeps the working-dir line, when cwd is outside the vault", () => {
		const out = buildObsidianSystemPrompt({
			...base,
			isFirstMessage: true,
			workingDirectory: "/somewhere/else",
		});
		expect(out).not.toContain("read and edit");
		expect(out).toContain("/somewhere/else");
	});

	it("gates on the true vault root (vaultRootPath), not vaultBasePath", () => {
		const out = buildObsidianSystemPrompt({
			...base,
			isFirstMessage: true,
			vaultBasePath: "/realvault/sub",
			workingDirectory: "/realvault/sub",
			vaultRootPath: "/realvault",
		});
		expect(out).toContain("read and edit");
	});

	it("hides the vault line when cwd is outside the true vault root", () => {
		const out = buildObsidianSystemPrompt({
			...base,
			isFirstMessage: true,
			vaultBasePath: "/external",
			workingDirectory: "/external",
			vaultRootPath: "/realvault",
		});
		expect(out).not.toContain("read and edit");
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
