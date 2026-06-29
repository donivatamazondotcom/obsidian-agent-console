import { describe, it, expect } from "vitest";
import {
	composeHostContextBriefing,
	isCwdInsideVault,
	HOST_IDENTITY_BLOCK,
	RENDERING_AFFORDANCES_BLOCK,
	VAULT_COLLABORATION_BLOCK,
	workingDirectoryBlock,
	DEFAULT_HOST_CONTEXT_BRIEFING_BLOCKS,
	type HostContextBriefingBlocks,
	normalizeHostContextBriefingSettings,
} from "../host-context-briefing";
import {
	WIKI_LINK_INSTRUCTION,
	TABLE_INSTRUCTION,
	LATEX_MATH_INSTRUCTION,
} from "../system-instructions";

const VAULT = "/Users/me/vault";

const allOn = (): HostContextBriefingBlocks => ({
	...DEFAULT_HOST_CONTEXT_BRIEFING_BLOCKS,
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

describe("composeHostContextBriefing", () => {
	it("assembles all four blocks in order when all are enabled and cwd is the vault", () => {
		const out = composeHostContextBriefing(
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
		const out = composeHostContextBriefing(
			{ blocks: allOn() },
			{ cwd: "/Users/me/repo", vaultRoot: VAULT },
		);
		expect(out).not.toContain(VAULT_COLLABORATION_BLOCK);
		// working-directory block still present, pointing at the external dir
		expect(out).toContain(workingDirectoryBlock("/Users/me/repo"));
	});

	it("keeps the vault-collaboration block for a vault subfolder cwd", () => {
		const sub = `${VAULT}/projects`;
		const out = composeHostContextBriefing(
			{ blocks: allOn() },
			{ cwd: sub, vaultRoot: VAULT },
		);
		expect(out).toContain(VAULT_COLLABORATION_BLOCK);
		expect(out).toContain(workingDirectoryBlock(sub));
	});

	it("omits the working-directory block when cwd is empty", () => {
		const out = composeHostContextBriefing(
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
		const out = composeHostContextBriefing(
			{ blocks: { ...allOn(), hostIdentity: false } },
			{ cwd: VAULT, vaultRoot: VAULT },
		);
		expect(out).not.toContain(HOST_IDENTITY_BLOCK);
		expect(out).toContain(RENDERING_AFFORDANCES_BLOCK);
		expect(out).toContain(VAULT_COLLABORATION_BLOCK);
	});

	it("removes exactly the deselected block (rendering off)", () => {
		const out = composeHostContextBriefing(
			{ blocks: { ...allOn(), rendering: false } },
			{ cwd: VAULT, vaultRoot: VAULT },
		);
		expect(out).not.toContain(RENDERING_AFFORDANCES_BLOCK);
		expect(out).toContain(HOST_IDENTITY_BLOCK);
	});

	it("returns null when no block is enabled and there is no custom text", () => {
		const out = composeHostContextBriefing(
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
		const out = composeHostContextBriefing(
			{ blocks: { ...allOn(), rendering: true } },
			{ cwd: VAULT, vaultRoot: VAULT },
		);
		expect(out).toContain(WIKI_LINK_INSTRUCTION);
		expect(out).toContain(TABLE_INSTRUCTION);
		expect(out).toContain(LATEX_MATH_INSTRUCTION);
	});

	describe("customText raw-edit escape", () => {
		it("injects custom text verbatim and bypasses block composition", () => {
			const out = composeHostContextBriefing(
				{
					blocks: {
						hostIdentity: false,
						rendering: false,
						workingDirectory: false,
						vaultCollaboration: false,
					},
					customText: "My exact briefing.",
				},
				{ cwd: "/Users/me/repo", vaultRoot: VAULT },
			);
			expect(out).toBe("My exact briefing.");
		});

		it("bypasses cwd-gating entirely (custom text wins even outside the vault)", () => {
			const out = composeHostContextBriefing(
				{ blocks: allOn(), customText: "Custom." },
				{ cwd: "/Users/me/repo", vaultRoot: VAULT },
			);
			expect(out).toBe("Custom.");
		});

		it("falls through to block composition when custom text is whitespace only", () => {
			const out = composeHostContextBriefing(
				{ blocks: allOn(), customText: "   \n  " },
				{ cwd: VAULT, vaultRoot: VAULT },
			);
			expect(out).toContain(HOST_IDENTITY_BLOCK);
		});
	});
});

describe("normalizeHostContextBriefingSettings", () => {
	it("returns full defaults for undefined / missing", () => {
		const s = normalizeHostContextBriefingSettings(undefined);
		expect(s).toEqual({
			blocks: {
				hostIdentity: true,
				rendering: true,
				workingDirectory: true,
				vaultCollaboration: true,
			},
			customText: "",
		});
	});

	it("returns defaults for a non-object (array / garbage)", () => {
		expect(normalizeHostContextBriefingSettings([1, 2])).toEqual({
			blocks: {
				hostIdentity: true,
				rendering: true,
				workingDirectory: true,
				vaultCollaboration: true,
			},
			customText: "",
		});
	});

	it("defaults missing individual block keys to true", () => {
		const s = normalizeHostContextBriefingSettings({
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
		const s = normalizeHostContextBriefingSettings({
			customText: "My briefing.",
		});
		expect(s.customText).toBe("My briefing.");
	});

	it("coerces a non-string customText to empty", () => {
		const s = normalizeHostContextBriefingSettings({ customText: 42 });
		expect(s.customText).toBe("");
	});

	it("ignores dormant promptInjection-shaped keys (superseded feature)", () => {
		const s = normalizeHostContextBriefingSettings({
			enabled: false,
			wikiLinks: true,
		});
		// no valid block keys → all defaults
		expect(s.blocks.hostIdentity).toBe(true);
		expect(s.customText).toBe("");
	});
});
