import { describe, it, expect } from "vitest";
import { preparePrompt, type PreparePromptInput } from "../message-sender";
import type { IVaultAccess } from "../vault-service";
import type { IMentionService } from "../../utils/mention-parser";
import type { ContextNote } from "../../types/context";

/**
 * [[ACP Context Note Hydration]] — reproduce-first coverage at the public
 * preparePrompt seam (the live path: contextNotes set).
 *
 * Channel 1 (pinned notes): a note's body is embedded once, on its first
 * delivered appearance, if it fits the 16,000-char gate (H1–H3, H6–H9).
 * Channel 3 (@[[mention]]): all-or-nothing at the same gate, no truncation
 * (H10–H12). `hydratedPaths` reports whose body reached the agent this turn,
 * so the caller can flip `hydrated` on send success (H6, H11).
 *
 * Expected values are literals (R5): 16,000 is the gate.
 */

type Block = {
	type: string;
	text?: string;
	uri?: string;
	resource?: { uri: string; text: string };
	annotations?: { priority?: number };
};

function textBlocks(blocks: Block[]): string[] {
	return blocks.filter((b) => b.type === "text").map((b) => b.text ?? "");
}

function vaultWith(files: Record<string, string>): {
	vaultAccess: IVaultAccess;
	mentionService: IMentionService;
} {
	const all = Object.keys(files).map((path) => ({
		path,
		basename: path.split("/").pop()!.replace(/\.md$/, ""),
		stat: { mtime: 1700000000000 },
	}));
	return {
		vaultAccess: {
			readNote: async (path: string) => {
				if (!(path in files)) throw new Error(`missing: ${path}`);
				return files[path];
			},
		} as unknown as IVaultAccess,
		mentionService: {
			getAllFiles: () => all,
		} as unknown as IMentionService,
	};
}

function pill(path: string, hydrated: boolean): ContextNote {
	return { path, source: "user", seen: false, hydrated };
}

const base: PreparePromptInput = {
	message: "hello agent",
	vaultBasePath: "/vault",
	contextNotes: [],
};

const SMALL = "design body";
const AT_GATE = "g".repeat(16000);
const OVER_GATE = "o".repeat(16001);
const MID = "m".repeat(12000); // between the old 10K cap and the 16K gate

// ---------------------------------------------------------------------------
// Channel 1 — first-appearance hydration
// ---------------------------------------------------------------------------

describe("Channel 1 hydration — plain-text agents", () => {
	it("TH01: an unhydrated pill ≤ gate embeds its body once and reports it delivered", async () => {
		const { vaultAccess, mentionService } = vaultWith({ "Design.md": SMALL });
		const r = await preparePrompt(
			{ ...base, contextNotes: [pill("Design.md", false)] },
			vaultAccess,
			mentionService,
		);
		const block = textBlocks(r.agentContent).find((t) =>
			t.startsWith('<obsidian_context_note ref="file:///vault/Design.md">'),
		);
		expect(block).toBeDefined();
		expect(block).toContain(SMALL);
		expect(block).toContain("point-in-time snapshot");
		expect(r.hydratedPaths).toEqual(["Design.md"]);
	});

	it("TH01: a hydrated pill is reference-only and is not re-reported", async () => {
		const { vaultAccess, mentionService } = vaultWith({ "Design.md": SMALL });
		const r = await preparePrompt(
			{ ...base, contextNotes: [pill("Design.md", true)] },
			vaultAccess,
			mentionService,
		);
		const block = textBlocks(r.agentContent).find((t) =>
			t.startsWith("<obsidian_context_note"),
		);
		expect(block).toBe(
			'<obsidian_context_note ref="file:///vault/Design.md">\nThe user has set this note as context for this chat. The conversation involves this note. Use the Read tool to examine its content when relevant.\n</obsidian_context_note>',
		);
		expect(r.hydratedPaths ?? []).toEqual([]);
	});

	it("a pill without the hydrated field (pre-migration) hydrates", async () => {
		const { vaultAccess, mentionService } = vaultWith({ "Old.md": SMALL });
		const legacy = { path: "Old.md", source: "user", seen: false } as ContextNote;
		const r = await preparePrompt(
			{ ...base, contextNotes: [legacy] },
			vaultAccess,
			mentionService,
		);
		expect(textBlocks(r.agentContent).join("\n")).toContain(SMALL);
		expect(r.hydratedPaths).toEqual(["Old.md"]);
	});

	it("a pill exactly at the 16,000-char gate hydrates whole", async () => {
		const { vaultAccess, mentionService } = vaultWith({ "Edge.md": AT_GATE });
		const r = await preparePrompt(
			{ ...base, contextNotes: [pill("Edge.md", false)] },
			vaultAccess,
			mentionService,
		);
		expect(textBlocks(r.agentContent).join("\n")).toContain(AT_GATE);
		expect(r.hydratedPaths).toEqual(["Edge.md"]);
	});

	it("TH02: a pill over the gate stays reference-only and unhydrated", async () => {
		const { vaultAccess, mentionService } = vaultWith({ "Big.md": OVER_GATE });
		const r = await preparePrompt(
			{ ...base, contextNotes: [pill("Big.md", false)] },
			vaultAccess,
			mentionService,
		);
		const all = textBlocks(r.agentContent).join("\n");
		expect(all).not.toContain("ooooo");
		expect(all).toContain('<obsidian_context_note ref="file:///vault/Big.md">');
		expect(r.hydratedPaths ?? []).toEqual([]);
	});

	it("TH08: several unhydrated pills each embed on the same message", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"A.md": "alpha body",
			"B.md": "beta body",
		});
		const r = await preparePrompt(
			{ ...base, contextNotes: [pill("A.md", false), pill("B.md", false)] },
			vaultAccess,
			mentionService,
		);
		const all = textBlocks(r.agentContent).join("\n");
		expect(all).toContain("alpha body");
		expect(all).toContain("beta body");
		expect(r.hydratedPaths).toEqual(["A.md", "B.md"]);
	});

	it("H9: a read failure falls back to reference-only without blocking the send", async () => {
		const { mentionService } = vaultWith({});
		const failing = {
			readNote: async () => {
				throw new Error("io");
			},
		} as unknown as IVaultAccess;
		const r = await preparePrompt(
			{ ...base, contextNotes: [pill("Gone.md", false)] },
			failing,
			mentionService,
		);
		const texts = textBlocks(r.agentContent);
		expect(texts).toContain("hello agent");
		expect(
			texts.some((t) =>
				t.startsWith('<obsidian_context_note ref="file:///vault/Gone.md">'),
			),
		).toBe(true);
		expect(r.hydratedPaths ?? []).toEqual([]);
	});
});

describe("Channel 1 hydration — embeddedContext agents", () => {
	it("first appearance is an embedded resource at priority 0.6", async () => {
		const { vaultAccess, mentionService } = vaultWith({ "Design.md": SMALL });
		const r = await preparePrompt(
			{
				...base,
				supportsEmbeddedContext: true,
				contextNotes: [pill("Design.md", false)],
			},
			vaultAccess,
			mentionService,
		);
		const res = (r.agentContent as Block[]).find((b) => b.type === "resource");
		expect(res?.resource?.uri).toBe("file:///vault/Design.md");
		expect(res?.resource?.text).toBe(SMALL);
		expect(res?.annotations?.priority).toBe(0.6);
		// The link stays alongside the body: ref handle + replay chip (I222).
		expect(
			(r.agentContent as Block[]).find((b) => b.type === "resource_link")?.uri,
		).toBe("file:///vault/Design.md");
		expect(r.hydratedPaths).toEqual(["Design.md"]);
	});

	it("a hydrated pill stays a resource_link", async () => {
		const { vaultAccess, mentionService } = vaultWith({ "Design.md": SMALL });
		const r = await preparePrompt(
			{
				...base,
				supportsEmbeddedContext: true,
				contextNotes: [pill("Design.md", true)],
			},
			vaultAccess,
			mentionService,
		);
		const blocks = r.agentContent as Block[];
		expect(blocks.some((b) => b.type === "resource")).toBe(false);
		expect(blocks.find((b) => b.type === "resource_link")?.uri).toBe(
			"file:///vault/Design.md",
		);
	});
});

// ---------------------------------------------------------------------------
// Channel 3 — mentions use the all-or-nothing gate (H10–H12)
// ---------------------------------------------------------------------------

describe("Channel 3 mention gate", () => {
	it("TH11: a 12K mention is inlined whole with no truncation marker", async () => {
		const { vaultAccess, mentionService } = vaultWith({ "Mid.md": MID });
		const r = await preparePrompt(
			{ ...base, message: "see @[[Mid]]" },
			vaultAccess,
			mentionService,
		);
		expect(textBlocks(r.agentContent)).toContain(
			`<obsidian_mentioned_note ref="file:///vault/Mid.md">\n${MID}\n</obsidian_mentioned_note>`,
		);
		expect(textBlocks(r.agentContent).join("\n")).not.toContain("Truncated from");
		expect(r.hydratedPaths).toEqual(["Mid.md"]);
	});

	it("a mention exactly at the gate is inlined whole (embedded)", async () => {
		const { vaultAccess, mentionService } = vaultWith({ "Edge.md": AT_GATE });
		const r = await preparePrompt(
			{ ...base, message: "@[[Edge]]", supportsEmbeddedContext: true },
			vaultAccess,
			mentionService,
		);
		const res = (r.agentContent as Block[]).find((b) => b.type === "resource");
		expect(res?.resource?.text).toBe(AT_GATE);
		expect(r.hydratedPaths).toEqual(["Edge.md"]);
	});

	it("TH12: a mention over the gate is reference-only (plain text)", async () => {
		const { vaultAccess, mentionService } = vaultWith({ "Big.md": OVER_GATE });
		const r = await preparePrompt(
			{ ...base, message: "see @[[Big]]" },
			vaultAccess,
			mentionService,
		);
		expect(textBlocks(r.agentContent)).toContain(
			'<obsidian_mentioned_note ref="file:///vault/Big.md">\nThe user mentioned this note. It is too large to include inline. Use the Read tool to examine its content when relevant.\n</obsidian_mentioned_note>',
		);
		expect(textBlocks(r.agentContent).join("\n")).not.toContain("ooooo");
		expect(r.hydratedPaths ?? []).toEqual([]);
	});

	it("TH12: a mention over the gate is a resource_link (embedded)", async () => {
		const { vaultAccess, mentionService } = vaultWith({ "Big.md": OVER_GATE });
		const r = await preparePrompt(
			{ ...base, message: "@[[Big]]", supportsEmbeddedContext: true },
			vaultAccess,
			mentionService,
		);
		const blocks = r.agentContent as Block[];
		expect(blocks.some((b) => b.type === "resource")).toBe(false);
		expect(blocks.find((b) => b.type === "resource_link")?.uri).toBe(
			"file:///vault/Big.md",
		);
		expect(r.hydratedPaths ?? []).toEqual([]);
	});

	it("H8/TH09: a same-turn mention of an unhydrated pill sends the body once", async () => {
		const { vaultAccess, mentionService } = vaultWith({ "Design.md": SMALL });
		const r = await preparePrompt(
			{
				...base,
				message: "look at @[[Design]]",
				contextNotes: [pill("Design.md", false)],
			},
			vaultAccess,
			mentionService,
		);
		const all = textBlocks(r.agentContent).join("\n");
		expect(all.split(SMALL).length - 1).toBe(1);
		expect(all).toContain('<obsidian_mentioned_note ref="file:///vault/Design.md">');
		expect(r.hydratedPaths).toEqual(["Design.md"]);
	});

	it("TH13/H12: re-mentioning a hydrated note inlines it again", async () => {
		const { vaultAccess, mentionService } = vaultWith({ "Design.md": "edited body" });
		const r = await preparePrompt(
			{
				...base,
				message: "again @[[Design]]",
				contextNotes: [pill("Design.md", true)],
			},
			vaultAccess,
			mentionService,
		);
		const all = textBlocks(r.agentContent).join("\n");
		expect(all.split("edited body").length - 1).toBe(1);
		expect(all).toContain('<obsidian_mentioned_note ref="file:///vault/Design.md">');
	});
});
