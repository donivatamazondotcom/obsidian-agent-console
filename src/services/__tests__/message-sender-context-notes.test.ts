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
