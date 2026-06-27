import { describe, it, expect } from "vitest";
import {
	preparePrompt,
	TITLE_RUBRIC,
	type PreparePromptInput,
} from "../message-sender";
import type { IVaultAccess } from "../vault-service";
import type { IMentionService } from "../../utils/mention-parser";

/**
 * F03 regression — the title rubric must be injected on the REAL send path.
 *
 * Real sends always pass `contextNotes` (useChatActions seeds it, even empty),
 * so preparePrompt routes through preparePromptWithContextNotes. That path
 * historically did NOT call buildSystemInstructions, so neither the title
 * rubric (F03) NOR the Obsidian formatting hints reached the agent — the agent
 * never emitted a <title> marker and the tab title never resolved (the T52
 * smoke-test failure, root-caused via studio [F03-DIAG] logs 2026-06-25).
 *
 * These tests fail against the unfixed context-notes path (red) and pass once
 * it injects buildSystemInstructions like the embedded/text-context paths do.
 */

const mentionService = {
	getAllFiles: () => [],
} as unknown as IMentionService;
const vaultAccess = {
	readNote: async () => "",
} as unknown as IVaultAccess;

function textBlocks(blocks: { type: string; text?: string }[]): string[] {
	return blocks
		.filter((b) => b.type === "text")
		.map((b) => b.text ?? "");
}

const base: PreparePromptInput = {
	message: "git merge vs rebase",
	vaultBasePath: "/vault",
	contextNotes: [], // forces the context-notes path (real-send path)
};

describe("preparePrompt context-notes path — system instructions (F03)", () => {
	it("injects the title rubric on the first message when agent-suggested", async () => {
		const r = await preparePrompt(
			{ ...base, isFirstMessage: true, titleStrategy: "agent-suggested" },
			vaultAccess,
			mentionService,
		);
		expect(textBlocks(r.agentContent)).toContain(TITLE_RUBRIC);
	});

	it("omits the rubric on a non-first message", async () => {
		const r = await preparePrompt(
			{
				...base,
				isFirstMessage: false,
				titleStrategy: "agent-suggested",
			},
			vaultAccess,
			mentionService,
		);
		expect(textBlocks(r.agentContent)).not.toContain(TITLE_RUBRIC);
	});

	it("omits the rubric under prompt-derived", async () => {
		const r = await preparePrompt(
			{ ...base, isFirstMessage: true, titleStrategy: "prompt-derived" },
			vaultAccess,
			mentionService,
		);
		expect(textBlocks(r.agentContent)).not.toContain(TITLE_RUBRIC);
	});

	it("still injects the Obsidian formatting hints on the first message (restored)", async () => {
		const r = await preparePrompt(
			{ ...base, isFirstMessage: true },
			vaultAccess,
			mentionService,
		);
		const texts = textBlocks(r.agentContent);
		expect(texts.some((t) => t.includes("wikilink"))).toBe(true);
		expect(texts.some((t) => t.includes("Markdown tables"))).toBe(true);
	});

	it("preserves the user message in agentContent", async () => {
		const r = await preparePrompt(
			{ ...base, isFirstMessage: true, titleStrategy: "agent-suggested" },
			vaultAccess,
			mentionService,
		);
		expect(textBlocks(r.agentContent)).toContain("git merge vs rebase");
	});
});

/**
 * I111 — title-rubric recency. The rubric must be the FINAL block immediately
 * before the user message (not buried in the leading systemBlocks), so a large
 * injected context/mention note can't push it far from where the agent starts
 * generating. Burying it at the head let tool-first / code-work prompts lead
 * with prose instead of <title>, the head buffer abandoned, and the
 * prompt-derived interim label was kept (root-caused from the raw session
 * store, 2026-06-27). The formatting hints still lead.
 *
 * Reproduce-first: with an intervening context-note block, the unfixed path
 * places the rubric BEFORE the context note (rubricIdx !== userIdx - 1) — red.
 */
describe("preparePrompt context-notes path — title rubric recency (I111)", () => {
	const withNote: PreparePromptInput = {
		message: "implement the newTab feature",
		vaultBasePath: "/vault",
		contextNotes: [
			{ path: "Quick Prompts.md", source: "mention", seen: false },
		],
	};

	it("places the rubric immediately before the user message, after context blocks", async () => {
		const r = await preparePrompt(
			{
				...withNote,
				isFirstMessage: true,
				titleStrategy: "agent-suggested",
			},
			vaultAccess,
			mentionService,
		);
		const texts = textBlocks(r.agentContent);
		const rubricIdx = texts.indexOf(TITLE_RUBRIC);
		const userIdx = texts.indexOf("implement the newTab feature");
		const ctxIdx = texts.findIndex((t) =>
			t.includes("obsidian_context_note"),
		);
		const hintIdx = texts.findIndex((t) => t.includes("wikilink"));

		expect(rubricIdx).toBeGreaterThanOrEqual(0);
		expect(userIdx).toBeGreaterThanOrEqual(0);
		expect(ctxIdx).toBeGreaterThanOrEqual(0);
		// Rubric is the final block before the user message (recency).
		expect(rubricIdx).toBe(userIdx - 1);
		// Rubric sits AFTER the injected context note — no longer head-buried.
		expect(rubricIdx).toBeGreaterThan(ctxIdx);
		// Formatting hints still lead (before the context block).
		expect(hintIdx).toBeLessThan(ctxIdx);
	});

	it("keeps the hints leading but drops the rubric when not agent-suggested", async () => {
		const r = await preparePrompt(
			{
				...withNote,
				isFirstMessage: true,
				titleStrategy: "prompt-derived",
			},
			vaultAccess,
			mentionService,
		);
		const texts = textBlocks(r.agentContent);
		expect(texts).not.toContain(TITLE_RUBRIC);
		expect(texts.some((t) => t.includes("wikilink"))).toBe(true);
	});
});
