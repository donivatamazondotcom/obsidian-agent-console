import { describe, it, expect } from "vitest";
import {
	preparePrompt,
	TITLE_RUBRIC,
	type PreparePromptInput,
} from "../message-sender";
import {
	DEFAULT_OBSIDIAN_SYSTEM_PROMPT_SETTINGS,
} from "../../utils/obsidian-system-prompt";
import type { IVaultAccess } from "../vault-service";
import type { IMentionService } from "../../utils/mention-parser";
import type {
	ImagePromptContent,
	ResourceLinkPromptContent,
} from "../../types/chat";

/**
 * Mutation-audit coverage for the LIVE send path (contextNotes set).
 *
 * Real sends always pass `contextNotes` (useChatActions seeds it, even
 * empty), so preparePrompt routes through preparePromptWithContextNotes —
 * the path where the F03 bug class shipped three green-tests-wrong-wiring
 * bugs. The 2026-07-31 mutation baseline scored this module 12.06% with
 * 310 no-coverage mutants; these tests enter at the public preparePrompt
 * seam with the same input shape useAgentMessages passes and assert the
 * assembled agentContent — the content that actually goes on the wire.
 *
 * Rubric: R2 (public seam, contextNotes set), R3 (asserts assembled
 * blocks, not mock calls), R4 (stubs only the vault/mention ports),
 * R5 (expected strings are literals, not re-derived).
 */

type TextBlock = { type: string; text?: string };

function textBlocks(blocks: TextBlock[]): string[] {
	return blocks.filter((b) => b.type === "text").map((b) => b.text ?? "");
}

/** Mention-capable stub: files findable by basename, content per path. */
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

const emptyVault = vaultWith({});

const base: PreparePromptInput = {
	message: "hello agent",
	vaultBasePath: "/vault",
	contextNotes: [], // live path
};

// ---------------------------------------------------------------------------
// Channel 3 — @[[mention]] blocks on the live path
// ---------------------------------------------------------------------------

describe("live path — mentioned notes (Channel 3)", () => {
	it("embeds a mention as a resource block when the agent supports embeddedContext", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Notes/Design.md": "design content",
		});
		const r = await preparePrompt(
			{
				...base,
				message: "review @[[Design]] please",
				supportsEmbeddedContext: true,
			},
			vaultAccess,
			mentionService,
		);
		const res = r.agentContent.find((b) => b.type === "resource") as {
			resource: { uri: string; mimeType: string; text: string };
			annotations: {
				audience: string[];
				priority: number;
				lastModified: string;
			};
		};
		expect(res).toBeDefined();
		expect(res.resource.uri).toBe("file:///vault/Notes/Design.md");
		expect(res.resource.mimeType).toBe("text/markdown");
		expect(res.resource.text).toBe("design content");
		expect(res.annotations.audience).toEqual(["assistant"]);
		expect(res.annotations.priority).toBe(1.0);
		expect(res.annotations.lastModified).toBe(
			new Date(1700000000000).toISOString(),
		);
	});

	it("embeds a mention as an <obsidian_mentioned_note> text block without embeddedContext", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Design.md": "design content",
		});
		const r = await preparePrompt(
			{
				...base,
				message: "review @[[Design]] please",
				supportsEmbeddedContext: false,
			},
			vaultAccess,
			mentionService,
		);
		expect(textBlocks(r.agentContent)).toContain(
			'<obsidian_mentioned_note ref="file:///vault/Design.md">\ndesign content\n</obsidian_mentioned_note>',
		);
	});

	it("defaults to the non-embedded XML format when supportsEmbeddedContext is omitted", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Design.md": "x",
		});
		const r = await preparePrompt(
			{ ...base, message: "see @[[Design]]" },
			vaultAccess,
			mentionService,
		);
		expect(r.agentContent.some((b) => b.type === "resource")).toBe(false);
		expect(
			textBlocks(r.agentContent).some((t) =>
				t.startsWith("<obsidian_mentioned_note"),
			),
		).toBe(true);
	});

	it("truncates a long mention at maxNoteLength and appends the truncation note (embedded)", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Big.md": "abcdefghij", // 10 chars
		});
		const r = await preparePrompt(
			{
				...base,
				message: "@[[Big]]",
				supportsEmbeddedContext: true,
				maxNoteLength: 4,
			},
			vaultAccess,
			mentionService,
		);
		const res = r.agentContent.find((b) => b.type === "resource") as {
			resource: { text: string };
		};
		expect(res.resource.text).toBe(
			"abcd\n\n[Note: Truncated from 10 to 4 characters]",
		);
	});

	it("truncates a long mention and appends the truncation note (XML text)", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Big.md": "abcdefghij",
		});
		const r = await preparePrompt(
			{
				...base,
				message: "@[[Big]]",
				supportsEmbeddedContext: false,
				maxNoteLength: 4,
			},
			vaultAccess,
			mentionService,
		);
		expect(textBlocks(r.agentContent)).toContain(
			'<obsidian_mentioned_note ref="file:///vault/Big.md">\nabcd\n\n[Note: Truncated from 10 to 4 characters]\n</obsidian_mentioned_note>',
		);
	});

	it("does NOT truncate content exactly at maxNoteLength (boundary)", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Edge.md": "abcd", // exactly 4
		});
		const r = await preparePrompt(
			{
				...base,
				message: "@[[Edge]]",
				supportsEmbeddedContext: true,
				maxNoteLength: 4,
			},
			vaultAccess,
			mentionService,
		);
		const res = r.agentContent.find((b) => b.type === "resource") as {
			resource: { text: string };
		};
		expect(res.resource.text).toBe("abcd");
	});

	it("applies the 10000-char default when maxNoteLength is omitted", async () => {
		const content = "x".repeat(10001);
		const { vaultAccess, mentionService } = vaultWith({
			"Huge.md": content,
		});
		const r = await preparePrompt(
			{ ...base, message: "@[[Huge]]", supportsEmbeddedContext: true },
			vaultAccess,
			mentionService,
		);
		const res = r.agentContent.find((b) => b.type === "resource") as {
			resource: { text: string };
		};
		expect(res.resource.text).toBe(
			"x".repeat(10000) +
				"\n\n[Note: Truncated from 10001 to 10000 characters]",
		);
	});

	it("skips a mention whose note fails to read, keeping the user message", async () => {
		const { mentionService } = vaultWith({ "Broken.md": "" });
		const failingVault = {
			readNote: async () => {
				throw new Error("io error");
			},
		} as unknown as IVaultAccess;
		const r = await preparePrompt(
			{ ...base, message: "see @[[Broken]]", supportsEmbeddedContext: true },
			failingVault,
			mentionService,
		);
		expect(r.agentContent.some((b) => b.type === "resource")).toBe(false);
		expect(textBlocks(r.agentContent)).toContain("see @[[Broken]]");
	});

	it("skips a mention that resolves to no file", async () => {
		const r = await preparePrompt(
			{ ...base, message: "see @[[Nowhere]]" },
			emptyVault.vaultAccess,
			emptyVault.mentionService,
		);
		expect(
			textBlocks(r.agentContent).some((t) =>
				t.startsWith("<obsidian_mentioned_note"),
			),
		).toBe(false);
		expect(textBlocks(r.agentContent)).toContain("see @[[Nowhere]]");
	});

	it("converts the mention path to WSL form when convertToWsl is set", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Note.md": "c",
		});
		const r = await preparePrompt(
			{
				...base,
				message: "@[[Note]]",
				vaultBasePath: "C:\\Users\\me\\vault",
				convertToWsl: true,
				supportsEmbeddedContext: false,
			},
			vaultAccess,
			mentionService,
		);
		expect(
			textBlocks(r.agentContent).some((t) =>
				t.includes('ref="file:///mnt/c/Users/me/vault/Note.md"'),
			),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Channels 1 & 2 — crystallized context notes + selection, through the live path
// ---------------------------------------------------------------------------

describe("live path — context notes and selection (Channels 1 & 2)", () => {
	it("renders a context note as an <obsidian_context_note> reference block (non-embedded)", async () => {
		const r = await preparePrompt(
			{
				...base,
				contextNotes: [
					{ path: "Specs/Plan.md", source: "mention", seen: false },
				],
			},
			emptyVault.vaultAccess,
			emptyVault.mentionService,
		);
		const block = textBlocks(r.agentContent).find((t) =>
			t.startsWith("<obsidian_context_note"),
		);
		expect(block).toBeDefined();
		expect(block).toContain('ref="file:///vault/Specs/Plan.md"');
		expect(block).toContain("Use the Read tool");
	});

	it("renders a context note as a resource_link when embeddedContext is supported", async () => {
		const r = await preparePrompt(
			{
				...base,
				supportsEmbeddedContext: true,
				contextNotes: [
					{ path: "Specs/Plan.md", source: "mention", seen: false },
				],
			},
			emptyVault.vaultAccess,
			emptyVault.mentionService,
		);
		const link = r.agentContent.find(
			(b) => b.type === "resource_link",
		) as { uri: string; name: string; mimeType: string };
		expect(link).toBeDefined();
		expect(link.uri).toBe("file:///vault/Specs/Plan.md");
		expect(link.name).toBe("Plan");
		expect(link.mimeType).toBe("text/markdown");
	});

	it("inlines the selection as an <obsidian_selection> block (non-embedded)", async () => {
		const r = await preparePrompt(
			{
				...base,
				selectionContext: {
					path: "Doc.md",
					fromLine: 3,
					toLine: 5,
					text: "picked lines",
				},
			},
			emptyVault.vaultAccess,
			emptyVault.mentionService,
		);
		expect(textBlocks(r.agentContent)).toContain(
			'<obsidian_selection ref="file:///vault/Doc.md" lines="3-5">\npicked lines\n\nThe user is focusing on this text right now.\n</obsidian_selection>',
		);
	});

	it("emits no selection block when selectionContext is null or omitted", async () => {
		for (const selectionContext of [null, undefined]) {
			const r = await preparePrompt(
				{ ...base, selectionContext },
				emptyVault.vaultAccess,
				emptyVault.mentionService,
			);
			expect(
				textBlocks(r.agentContent).some((t) =>
					t.includes("obsidian_selection"),
				),
			).toBe(false);
		}
	});
});

// ---------------------------------------------------------------------------
// Assembly — ordering, passthrough, display content
// ---------------------------------------------------------------------------

const IMG: ImagePromptContent = {
	type: "image",
	data: "aGk=",
	mimeType: "image/png",
};
const LINK: ResourceLinkPromptContent = {
	type: "resource_link",
	uri: "file:///vault/attached.md",
	name: "attached",
};

describe("live path — assembly order and passthrough", () => {
	it("assembles hints → context → mention → rubric → message → images → resourceLinks", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"M.md": "mention body",
		});
		const r = await preparePrompt(
			{
				...base,
				message: "do the thing @[[M]]",
				isFirstMessage: true,
				titleStrategy: "agent-suggested",
				contextNotes: [
					{ path: "Ctx.md", source: "user", seen: true },
				],
				images: [IMG],
				resourceLinks: [LINK],
			},
			vaultAccess,
			mentionService,
		);
		const kinds = r.agentContent.map((b) => {
			if (b.type !== "text") return b.type;
			const t = (b as { text: string }).text;
			if (t.startsWith("<obsidian_system_instruction>")) return "hints";
			if (t.startsWith("<obsidian_context_note")) return "context";
			if (t.startsWith("<obsidian_mentioned_note")) return "mention";
			if (t === TITLE_RUBRIC) return "rubric";
			return "message";
		});
		expect(kinds).toEqual([
			"hints",
			"context",
			"mention",
			"rubric",
			"message",
			"image",
			"resource_link",
		]);
	});

	it("passes images through to both agentContent and displayContent", async () => {
		const r = await preparePrompt(
			{ ...base, images: [IMG] },
			emptyVault.vaultAccess,
			emptyVault.mentionService,
		);
		expect(r.agentContent).toContainEqual(IMG);
		expect(r.displayContent).toContainEqual(IMG);
	});

	it("passes resourceLinks through to agentContent", async () => {
		const r = await preparePrompt(
			{ ...base, resourceLinks: [LINK] },
			emptyVault.vaultAccess,
			emptyVault.mentionService,
		);
		expect(r.agentContent).toContainEqual(LINK);
	});

	it("emits no empty text block when the message is empty", async () => {
		const r = await preparePrompt(
			{ ...base, message: "", images: [IMG] },
			emptyVault.vaultAccess,
			emptyVault.mentionService,
		);
		expect(textBlocks(r.agentContent)).not.toContain("");
		expect(r.displayContent).toEqual([IMG]);
	});

	it("returns no autoMentionContext on the live path (ContextStrip owns display)", async () => {
		const r = await preparePrompt(
			base,
			emptyVault.vaultAccess,
			emptyVault.mentionService,
		);
		expect(r.autoMentionContext).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// L386 — the respondInLanguage gate on the title rubric (survived baseline)
// ---------------------------------------------------------------------------

describe("live path — title rubric respondInLanguage gate (slice #4)", () => {
	const first: PreparePromptInput = {
		...base,
		isFirstMessage: true,
		titleStrategy: "agent-suggested",
		replyLanguageName: "Korean",
	};

	it("localizes the rubric when the toggle is on", async () => {
		const r = await preparePrompt(
			{
				...first,
				obsidianSystemPrompt: DEFAULT_OBSIDIAN_SYSTEM_PROMPT_SETTINGS,
			},
			emptyVault.vaultAccess,
			emptyVault.mentionService,
		);
		expect(textBlocks(r.agentContent)).toContain(
			`${TITLE_RUBRIC} Write the title in Korean.`,
		);
	});

	it("emits the plain rubric when respondInLanguage is explicitly false", async () => {
		const r = await preparePrompt(
			{
				...first,
				obsidianSystemPrompt: {
					...DEFAULT_OBSIDIAN_SYSTEM_PROMPT_SETTINGS,
					blocks: {
						...DEFAULT_OBSIDIAN_SYSTEM_PROMPT_SETTINGS.blocks,
						respondInLanguage: false,
					},
				},
			},
			emptyVault.vaultAccess,
			emptyVault.mentionService,
		);
		const texts = textBlocks(r.agentContent);
		expect(texts).toContain(TITLE_RUBRIC);
		expect(
			texts.some((t) => t.includes("Write the title in")),
		).toBe(false);
	});

	it("defaults the toggle ON when obsidianSystemPrompt is absent (pre-feature input)", async () => {
		const r = await preparePrompt(
			first,
			emptyVault.vaultAccess,
			emptyVault.mentionService,
		);
		expect(textBlocks(r.agentContent)).toContain(
			`${TITLE_RUBRIC} Write the title in Korean.`,
		);
	});

	it("emits the plain rubric when no reply language is set", async () => {
		const r = await preparePrompt(
			{ ...first, replyLanguageName: null },
			emptyVault.vaultAccess,
			emptyVault.mentionService,
		);
		expect(textBlocks(r.agentContent)).toContain(TITLE_RUBRIC);
	});
});

// ---------------------------------------------------------------------------
// Batch 2 — residual-survivor kills (exact-shape assertions)
// ---------------------------------------------------------------------------

describe("live path — exact content shapes (residual survivors)", () => {
	it("displayContent is exactly [message, ...images] in order", async () => {
		const r = await preparePrompt(
			{ ...base, images: [IMG] },
			emptyVault.vaultAccess,
			emptyVault.mentionService,
		);
		expect(r.displayContent).toEqual([
			{ type: "text", text: "hello agent" },
			IMG,
		]);
	});

	it("agentContent is exactly [] for an empty message with no attachments or context", async () => {
		const r = await preparePrompt(
			{ ...base, message: "" },
			emptyVault.vaultAccess,
			emptyVault.mentionService,
		);
		expect(r.agentContent).toEqual([]);
		expect(r.displayContent).toEqual([]);
	});

	it("leaves a Windows path unconverted when convertToWsl is off (default)", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Note.md": "c",
		});
		const r = await preparePrompt(
			{
				...base,
				message: "@[[Note]]",
				vaultBasePath: "C:\\Users\\me\\vault",
				supportsEmbeddedContext: false,
			},
			vaultAccess,
			mentionService,
		);
		expect(
			textBlocks(r.agentContent).some((t) =>
				t.includes('ref="file:///C:/Users/me/vault/Note.md"'),
			),
		).toBe(true);
	});
});
