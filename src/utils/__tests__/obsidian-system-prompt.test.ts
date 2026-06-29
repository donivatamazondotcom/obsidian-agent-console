import { describe, it, expect } from "vitest";
import {
	composeObsidianSystemPrompt,
	isCwdInsideVault,
	HOST_IDENTITY_BLOCK,
	RENDERING_AFFORDANCES_BLOCK,
	VAULT_COLLABORATION_BLOCK,
	workingDirectoryBlock,
	DEFAULT_OBSIDIAN_SYSTEM_PROMPT_BLOCKS,
	type ObsidianSystemPromptBlocks,
	normalizeObsidianSystemPromptSettings,
} from "../obsidian-system-prompt";
import {
	WIKI_LINK_INSTRUCTION,
	TABLE_INSTRUCTION,
	LATEX_MATH_INSTRUCTION,
} from "../system-instructions";

const VAULT = "/Users/me/vault";

const allOn = (): ObsidianSystemPromptBlocks => ({
	...DEFAULT_OBSIDIAN_SYSTEM_PROMPT_BLOCKS,
});

describe("isCwdInsideVault", () => {
	it("is true at the vault root", () => {
		expect(isCwdInsideVault(VAULT, VAULT)).toBe(true);
	});

	it("is true for a descendant of the vault", () => {
		expect(isCwdInsideVault(`${VAULT}/projects/x`, VAULT)).toBe(true);
	});

	it("tolerates a trailing slash on either side", () => {
		expect(isCwdInsideVault(`${VAULT}/`, VAULT)).toBe(true);
		expect(isCwdInsideVault(VAULT, `${VAULT}/`)).toBe(true);
	});

	it("is false for a directory outside the vault", () => {
		expect(isCwdInsideVault("/Users/me/repo", VAULT)).toBe(false);
	});

	it("is false for a sibling that shares a name prefix (not a real descendant)", () => {
		expect(isCwdInsideVault("/Users/me/vault-other", VAULT)).toBe(false);
	});

	it("is false for empty inputs", () => {
		expect(isCwdInsideVault("", VAULT)).toBe(false);
		expect(isCwdInsideVault(VAULT, "")).toBe(false);
	});
});

describe("composeObsidianSystemPrompt", () => {
	it("assembles all four blocks in order when all are enabled and cwd is the vault", () => {
		const out = composeObsidianSystemPrompt(
			{ blocks: allOn() },
			{ cwd: VAULT, vaultRoot: VAULT },
		);
		expect(out).toBe(
			[
				HOST_IDENTITY_BLOCK,
				RENDERING_AFFORDANCES_BLOCK,
				workingDirectoryBlock(VAULT),
				VAULT_COLLABORATION_BLOCK,
			].join("\n\n"),
		);
	});

	it("omits the vault-collaboration block when cwd is outside the vault", () => {
		const out = composeObsidianSystemPrompt(
			{ blocks: allOn() },
			{ cwd: "/Users/me/repo", vaultRoot: VAULT },
		);
		expect(out).not.toContain(VAULT_COLLABORATION_BLOCK);
		// working-directory block still present, pointing at the external dir
		expect(out).toContain(workingDirectoryBlock("/Users/me/repo"));
	});

	it("keeps the vault-collaboration block for a vault subfolder cwd", () => {
		const sub = `${VAULT}/projects`;
		const out = composeObsidianSystemPrompt(
			{ blocks: allOn() },
			{ cwd: sub, vaultRoot: VAULT },
		);
		expect(out).toContain(VAULT_COLLABORATION_BLOCK);
		expect(out).toContain(workingDirectoryBlock(sub));
	});

	it("omits the working-directory block when cwd is empty", () => {
		const out = composeObsidianSystemPrompt(
			{ blocks: allOn() },
			{ cwd: "", vaultRoot: VAULT },
		);
		expect(out).not.toContain("Your working directory is");
		// empty cwd is also not inside the vault → no vault-collaboration block
		expect(out).not.toContain(VAULT_COLLABORATION_BLOCK);
		expect(out).toContain(HOST_IDENTITY_BLOCK);
		expect(out).toContain(RENDERING_AFFORDANCES_BLOCK);
	});

	it("removes exactly the deselected block (host identity off)", () => {
		const out = composeObsidianSystemPrompt(
			{ blocks: { ...allOn(), hostIdentity: false } },
			{ cwd: VAULT, vaultRoot: VAULT },
		);
		expect(out).not.toContain(HOST_IDENTITY_BLOCK);
		expect(out).toContain(RENDERING_AFFORDANCES_BLOCK);
		expect(out).toContain(VAULT_COLLABORATION_BLOCK);
	});

	it("removes exactly the deselected block (rendering off)", () => {
		const out = composeObsidianSystemPrompt(
			{ blocks: { ...allOn(), rendering: false } },
			{ cwd: VAULT, vaultRoot: VAULT },
		);
		expect(out).not.toContain(RENDERING_AFFORDANCES_BLOCK);
		expect(out).toContain(HOST_IDENTITY_BLOCK);
	});

	it("returns null when no block is enabled and there is no custom text", () => {
		const out = composeObsidianSystemPrompt(
			{
				blocks: {
					hostIdentity: false,
					rendering: false,
					workingDirectory: false,
					vaultCollaboration: false,
				},
			},
			{ cwd: VAULT, vaultRoot: VAULT },
		);
		expect(out).toBeNull();
	});

	it("folds the three shipped formatting instructions into the rendering block", () => {
		const out = composeObsidianSystemPrompt(
			{ blocks: { ...allOn(), rendering: true } },
			{ cwd: VAULT, vaultRoot: VAULT },
		);
		expect(out).toContain(WIKI_LINK_INSTRUCTION);
		expect(out).toContain(TABLE_INSTRUCTION);
		expect(out).toContain(LATEX_MATH_INSTRUCTION);
	});

	describe("appendText (Your vault context)", () => {
		it("appends the user's text after the composed blocks", () => {
			const out = composeObsidianSystemPrompt(
				{ blocks: allOn(), appendText: "Daily notes live in Journal/." },
				{ cwd: VAULT, vaultRoot: VAULT },
			);
			expect(out).toContain(HOST_IDENTITY_BLOCK);
			expect(out?.endsWith("Daily notes live in Journal/.")).toBe(true);
		});

		it("returns just the append text when all blocks are off", () => {
			const out = composeObsidianSystemPrompt(
				{
					blocks: {
						hostIdentity: false,
						rendering: false,
						workingDirectory: false,
						vaultCollaboration: false,
					},
					appendText: "Only my context.",
				},
				{ cwd: VAULT, vaultRoot: VAULT },
			);
			expect(out).toBe("Only my context.");
		});

		it("ignores whitespace-only append text", () => {
			const withWs = composeObsidianSystemPrompt(
				{ blocks: allOn(), appendText: "   \n  " },
				{ cwd: VAULT, vaultRoot: VAULT },
			);
			const without = composeObsidianSystemPrompt(
				{ blocks: allOn() },
				{ cwd: VAULT, vaultRoot: VAULT },
			);
			expect(withWs).toBe(without);
		});
	});

	describe("full mode (Edit full prompt)", () => {
		it("returns customText verbatim and ignores blocks + cwd + append", () => {
			const out = composeObsidianSystemPrompt(
				{
					blocks: allOn(),
					mode: "full",
					customText: "My exact prompt.",
					appendText: "ignored",
				},
				{ cwd: "/Users/me/repo", vaultRoot: VAULT },
			);
			expect(out).toBe("My exact prompt.");
		});

		it("returns null for an empty full prompt", () => {
			const out = composeObsidianSystemPrompt(
				{ blocks: allOn(), mode: "full", customText: "   " },
				{ cwd: VAULT, vaultRoot: VAULT },
			);
			expect(out).toBeNull();
		});

		it("options mode ignores customText (only full mode uses it)", () => {
			const out = composeObsidianSystemPrompt(
				{
					blocks: allOn(),
					mode: "options",
					customText: "should be ignored",
				},
				{ cwd: VAULT, vaultRoot: VAULT },
			);
			expect(out).not.toContain("should be ignored");
			expect(out).toContain(HOST_IDENTITY_BLOCK);
		});
	});
});

describe("normalizeObsidianSystemPromptSettings", () => {
	it("returns full defaults for undefined / missing", () => {
		const s = normalizeObsidianSystemPromptSettings(undefined);
		expect(s).toEqual({
			blocks: {
				hostIdentity: true,
				rendering: true,
				workingDirectory: true,
				vaultCollaboration: true,
			},
			appendText: "",
			customText: "",
			mode: "options",
		});
	});

	it("returns defaults for a non-object (array / garbage)", () => {
		expect(normalizeObsidianSystemPromptSettings([1, 2])).toEqual({
			blocks: {
				hostIdentity: true,
				rendering: true,
				workingDirectory: true,
				vaultCollaboration: true,
			},
			appendText: "",
			customText: "",
			mode: "options",
		});
	});

	it("defaults missing individual block keys to true", () => {
		const s = normalizeObsidianSystemPromptSettings({
			blocks: { vaultCollaboration: false },
		});
		expect(s.blocks).toEqual({
			hostIdentity: true,
			rendering: true,
			workingDirectory: true,
			vaultCollaboration: false,
		});
	});

	it("preserves a string customText", () => {
		const s = normalizeObsidianSystemPromptSettings({
			customText: "My briefing.",
		});
		expect(s.customText).toBe("My briefing.");
	});

	it("coerces a non-string customText to empty", () => {
		const s = normalizeObsidianSystemPromptSettings({ customText: 42 });
		expect(s.customText).toBe("");
	});

	it("ignores dormant promptInjection-shaped keys (superseded feature)", () => {
		const s = normalizeObsidianSystemPromptSettings({
			enabled: false,
			wikiLinks: true,
		});
		// no valid block keys → all defaults
		expect(s.blocks.hostIdentity).toBe(true);
		expect(s.customText).toBe("");
	});

	it("defaults to options mode and empty appendText", () => {
		const s = normalizeObsidianSystemPromptSettings({});
		expect(s.mode).toBe("options");
		expect(s.appendText).toBe("");
	});

	it("preserves appendText", () => {
		const s = normalizeObsidianSystemPromptSettings({
			appendText: "my vault context",
		});
		expect(s.appendText).toBe("my vault context");
	});

	it("infers full mode for a legacy customText with no mode", () => {
		const s = normalizeObsidianSystemPromptSettings({
			customText: "legacy replace",
		});
		expect(s.mode).toBe("full");
	});
});
