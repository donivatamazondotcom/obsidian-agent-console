import { describe, it, expect } from "vitest";
import { preparePrompt, type PreparePromptInput } from "../message-sender";
import type { IVaultAccess } from "../vault-service";
import type { NoteMetadata } from "../../types/vault";
import type { IMentionService } from "../../utils/mention-parser";

/**
 * Mutation-audit coverage for the LEGACY fallback paths (contextNotes
 * undefined): preparePromptWithEmbeddedContext and
 * preparePromptWithTextContext, plus the auto-mention builders.
 *
 * These paths are still shipped code, reachable through the public
 * preparePrompt seam whenever a caller does not provide contextNotes.
 * The 2026-07-31 baseline had ~150 no-coverage mutants here, including
 * the routing conditional at preparePrompt itself (a `→ true` mutation
 * that forces every send down the embedded path survived).
 *
 * Rubric: R2 (public preparePrompt seam — the exact shape a legacy
 * caller passes), R3 (asserts the assembled content), R4 (vault/mention
 * port stubs only), R5 (expected strings are literals).
 */

type TextBlock = { type: string; text?: string };

function textBlocks(blocks: TextBlock[]): string[] {
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

function note(over: Partial<NoteMetadata> = {}): NoteMetadata {
	return {
		path: "Active.md",
		name: "Active",
		extension: "md",
		created: 1690000000000,
		modified: 1700000000000,
		...over,
	};
}

// No contextNotes key at all — the legacy caller shape.
const base: PreparePromptInput = {
	message: "hello agent",
	vaultBasePath: "/vault",
};

// ---------------------------------------------------------------------------
// Routing — the preparePrompt capability fork (survived baseline: `→ true`)
// ---------------------------------------------------------------------------

describe("legacy routing — supportsEmbeddedContext fork", () => {
	it("routes to the resource-block format when embeddedContext is supported", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Ref.md": "ref body",
		});
		const r = await preparePrompt(
			{ ...base, message: "see @[[Ref]]", supportsEmbeddedContext: true },
			vaultAccess,
			mentionService,
		);
		expect(r.agentContent.some((b) => b.type === "resource")).toBe(true);
		expect(
			textBlocks(r.agentContent).some((t) =>
				t.includes("<obsidian_mentioned_note"),
			),
		).toBe(false);
	});

	it("routes to the XML text format when embeddedContext is NOT supported", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Ref.md": "ref body",
		});
		const r = await preparePrompt(
			{ ...base, message: "see @[[Ref]]", supportsEmbeddedContext: false },
			vaultAccess,
			mentionService,
		);
		expect(r.agentContent.some((b) => b.type === "resource")).toBe(false);
		const combined = textBlocks(r.agentContent).find((t) =>
			t.includes("<obsidian_mentioned_note"),
		);
		expect(combined).toBeDefined();
		// text-context uses the raw absolute path, not a file:// URI
		expect(combined).toContain('ref="/vault/Ref.md"');
		expect(combined).toContain("ref body");
	});
});

// ---------------------------------------------------------------------------
// Embedded legacy path — auto-mention resource channel
// ---------------------------------------------------------------------------

describe("embedded legacy path — auto-mention", () => {
	it("announces an active note without selection as an opened-note hint", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Active.md": "active body",
		});
		const r = await preparePrompt(
			{ ...base, supportsEmbeddedContext: true, activeNote: note() },
			vaultAccess,
			mentionService,
		);
		expect(
			textBlocks(r.agentContent).some(
				(t) =>
					t.includes("The user has opened the note") &&
					t.includes("file:///vault/Active.md"),
			),
		).toBe(true);
	});

	it("sends the selection as a resource block plus a focus hint, and prefixes the message with the line range", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Active.md": "l0\nl1\nl2\nl3",
		});
		const r = await preparePrompt(
			{
				...base,
				supportsEmbeddedContext: true,
				activeNote: note({
					selection: {
						from: { line: 1, ch: 0 },
						to: { line: 2, ch: 2 },
					},
				}),
			},
			vaultAccess,
			mentionService,
		);
		const res = r.agentContent.find((b) => b.type === "resource") as {
			resource: { uri: string; text: string };
			annotations: { priority: number };
		};
		expect(res).toBeDefined();
		expect(res.resource.text).toBe("l1\nl2");
		expect(res.annotations.priority).toBe(0.8);
		expect(
			textBlocks(r.agentContent).some((t) =>
				t.includes("selected lines 2-3"),
			),
		).toBe(true);
		// 1-based auto-mention prefix on the user text block
		expect(textBlocks(r.agentContent)).toContain(
			"@[[Active]]:2-3\nhello agent",
		);
		// badge mirrors the 1-based range
		expect(r.autoMentionContext).toEqual({
			noteName: "Active",
			notePath: "Active.md",
			selection: { fromLine: 2, toLine: 3 },
		});
	});

	it("falls back to a read-the-lines hint when the selection read fails", async () => {
		const mentionService = {
			getAllFiles: () => [],
		} as unknown as IMentionService;
		const failingVault = {
			readNote: async () => {
				throw new Error("gone");
			},
		} as unknown as IVaultAccess;
		const r = await preparePrompt(
			{
				...base,
				supportsEmbeddedContext: true,
				activeNote: note({
					selection: {
						from: { line: 0, ch: 0 },
						to: { line: 0, ch: 1 },
					},
				}),
			},
			failingVault,
			mentionService,
		);
		expect(
			textBlocks(r.agentContent).some(
				(t) =>
					t.includes("The user has selected lines 1-1") &&
					t.includes("use the Read tool"),
			),
		).toBe(true);
		expect(r.agentContent.some((b) => b.type === "resource")).toBe(false);
	});

	it("truncates an oversized selection and appends the truncation note", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Active.md": "abcdefghij", // one line, 10 chars
		});
		const r = await preparePrompt(
			{
				...base,
				supportsEmbeddedContext: true,
				maxSelectionLength: 4,
				activeNote: note({
					selection: {
						from: { line: 0, ch: 0 },
						to: { line: 0, ch: 9 },
					},
				}),
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

	it("keeps the auto-mention resource but drops the text prefix on a slash command", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Active.md": "body",
		});
		const r = await preparePrompt(
			{
				...base,
				message: "/compact",
				supportsEmbeddedContext: true,
				activeNote: note(),
			},
			vaultAccess,
			mentionService,
		);
		// resource-channel context still flows (spec-compliant with slash commands)
		expect(
			textBlocks(r.agentContent).some((t) =>
				t.includes("The user has opened the note"),
			),
		).toBe(true);
		// but the text block keeps "/" at char 0
		expect(textBlocks(r.agentContent)).toContain("/compact");
		// badge stays — the resource channel did carry the note
		expect(r.autoMentionContext).toBeDefined();
	});

	it("suppresses the auto-mention channel entirely when disabled", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Active.md": "body",
		});
		const r = await preparePrompt(
			{
				...base,
				supportsEmbeddedContext: true,
				activeNote: note(),
				isAutoMentionDisabled: true,
			},
			vaultAccess,
			mentionService,
		);
		expect(
			textBlocks(r.agentContent).some((t) =>
				t.includes("The user has opened the note"),
			),
		).toBe(false);
		expect(textBlocks(r.agentContent)).toContain("hello agent");
		expect(r.autoMentionContext).toBeUndefined();
	});

	it("injects the system briefing and preserves display content on the embedded path", async () => {
		const { vaultAccess, mentionService } = vaultWith({});
		const r = await preparePrompt(
			{ ...base, supportsEmbeddedContext: true, isFirstMessage: true },
			vaultAccess,
			mentionService,
		);
		expect(
			textBlocks(r.agentContent).some((t) =>
				t.startsWith("<obsidian_system_instruction>"),
			),
		).toBe(true);
		expect(r.displayContent).toEqual([
			{ type: "text", text: "hello agent" },
		]);
	});
});

// ---------------------------------------------------------------------------
// Text-context legacy path — XML fallback
// ---------------------------------------------------------------------------

describe("text-context legacy path — XML fallback", () => {
	it("announces an active note without selection as an <obsidian_opened_note> block", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Active.md": "body",
		});
		const r = await preparePrompt(
			{ ...base, supportsEmbeddedContext: false, activeNote: note() },
			vaultAccess,
			mentionService,
		);
		const combined = textBlocks(r.agentContent)[0];
		expect(combined).toContain(
			"<obsidian_opened_note>The user opened the note /vault/Active.md",
		);
		// context blocks are joined before the user message
		expect(combined).toMatch(/hello agent$/);
	});

	it("inlines the selected lines in the opened-note block with a 1-based range", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Active.md": "l0\nl1\nl2",
		});
		const r = await preparePrompt(
			{
				...base,
				supportsEmbeddedContext: false,
				activeNote: note({
					selection: {
						from: { line: 1, ch: 0 },
						to: { line: 2, ch: 0 },
					},
				}),
			},
			vaultAccess,
			mentionService,
		);
		const combined = textBlocks(r.agentContent)[0];
		expect(combined).toContain(
			'<obsidian_opened_note selection="lines 2-3">',
		);
		expect(combined).toContain("l1\nl2");
		expect(combined).toContain(
			"selected the following text (lines 2-3)",
		);
		// prefix on the trailing user message
		expect(combined).toContain("@[[Active]]:2-3\nhello agent");
	});

	it("falls back to a single-line hint when the selection read fails", async () => {
		const mentionService = {
			getAllFiles: () => [],
		} as unknown as IMentionService;
		const failingVault = {
			readNote: async () => {
				throw new Error("gone");
			},
		} as unknown as IVaultAccess;
		const r = await preparePrompt(
			{
				...base,
				supportsEmbeddedContext: false,
				activeNote: note({
					selection: {
						from: { line: 0, ch: 0 },
						to: { line: 1, ch: 0 },
					},
				}),
			},
			failingVault,
			mentionService,
		);
		const combined = textBlocks(r.agentContent)[0];
		expect(combined).toContain(
			"focusing on lines 1-2",
		);
		expect(combined).toContain("Read tool to examine the specific lines");
	});

	it("uses the long-form truncation note for oversized mentioned notes", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Big.md": "abcdefghij",
		});
		const r = await preparePrompt(
			{
				...base,
				message: "see @[[Big]]",
				supportsEmbeddedContext: false,
				maxNoteLength: 4,
			},
			vaultAccess,
			mentionService,
		);
		const combined = textBlocks(r.agentContent)[0];
		expect(combined).toContain(
			"[Note: This note was truncated. Original length: 10 characters, showing first 4 characters]",
		);
	});

	it("drops context blocks AND the badge on a slash command (text path ships no context)", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Active.md": "body",
		});
		const r = await preparePrompt(
			{
				...base,
				message: "/compact",
				supportsEmbeddedContext: false,
				activeNote: note(),
			},
			vaultAccess,
			mentionService,
		);
		expect(textBlocks(r.agentContent)).toEqual(["/compact"]);
		expect(r.autoMentionContext).toBeUndefined();
	});

	it("returns no text block at all for an empty message with no context", async () => {
		const { vaultAccess, mentionService } = vaultWith({});
		const r = await preparePrompt(
			{ ...base, message: "", supportsEmbeddedContext: false },
			vaultAccess,
			mentionService,
		);
		expect(r.agentContent).toEqual([]);
	});

	it("wraps the first-message briefing inside the combined text block", async () => {
		const { vaultAccess, mentionService } = vaultWith({});
		const r = await preparePrompt(
			{ ...base, supportsEmbeddedContext: false, isFirstMessage: true },
			vaultAccess,
			mentionService,
		);
		const combined = textBlocks(r.agentContent)[0];
		expect(combined).toContain("<obsidian_system_instruction>");
		expect(combined).toContain("</obsidian_system_instruction>");
		expect(combined).toMatch(/hello agent$/);
	});
});

// ---------------------------------------------------------------------------
// Batch 2 — residual-survivor kills
// ---------------------------------------------------------------------------

describe("legacy paths — title rubric placement (residual no-coverage)", () => {
	it("embedded path: rubric block sits immediately before the user text", async () => {
		const { vaultAccess, mentionService } = vaultWith({});
		const r = await preparePrompt(
			{
				...base,
				supportsEmbeddedContext: true,
				isFirstMessage: true,
				titleStrategy: "agent-suggested",
			},
			vaultAccess,
			mentionService,
		);
		const texts = textBlocks(r.agentContent);
		const rubricIdx = texts.findIndex((t) => t.includes("<title>"));
		const userIdx = texts.indexOf("hello agent");
		expect(rubricIdx).toBeGreaterThanOrEqual(0);
		expect(rubricIdx).toBe(userIdx - 1);
	});

	it("text-context path: rubric is wrapped in its own <obsidian_system_instruction> as the LAST context block", async () => {
		const { vaultAccess, mentionService } = vaultWith({});
		const r = await preparePrompt(
			{
				...base,
				supportsEmbeddedContext: false,
				isFirstMessage: true,
				titleStrategy: "agent-suggested",
			},
			vaultAccess,
			mentionService,
		);
		const combined = textBlocks(r.agentContent)[0];
		const wrapped = combined.match(
			/<obsidian_system_instruction>\n[^<]*<title>[\s\S]*?<\/obsidian_system_instruction>/,
		);
		expect(wrapped).not.toBeNull();
		// the rubric wrapper is the final context block before the user message
		const afterRubric = combined.slice(
			combined.lastIndexOf("</obsidian_system_instruction>"),
		);
		expect(afterRubric).toBe(
			"</obsidian_system_instruction>\n\nhello agent",
		);
	});
});

describe("legacy paths — defaults and boundaries (residual survivors)", () => {
	it("embedded path applies the 10000-char default maxNoteLength", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Huge.md": "y".repeat(10001),
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
			"y".repeat(10000) +
				"\n\n[Note: Truncated from 10001 to 10000 characters]",
		);
	});

	it("text-context path applies the 10000-char default maxSelectionLength", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Active.md": "z".repeat(10002), // single line, over the default
		});
		const r = await preparePrompt(
			{
				...base,
				supportsEmbeddedContext: false,
				activeNote: note({
					selection: {
						from: { line: 0, ch: 0 },
						to: { line: 0, ch: 1 },
					},
				}),
			},
			vaultAccess,
			mentionService,
		);
		const combined = textBlocks(r.agentContent)[0];
		expect(combined).toContain(
			"[Note: The selection was truncated. Original length: 10002 characters, showing first 10000 characters]",
		);
		expect(combined).toContain("z".repeat(10000));
		expect(combined).not.toContain("z".repeat(10001));
	});

	it("does NOT truncate a selection exactly at the limit (boundary)", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Active.md": "abcd", // exactly 4
		});
		const r = await preparePrompt(
			{
				...base,
				supportsEmbeddedContext: true,
				maxSelectionLength: 4,
				activeNote: note({
					selection: {
						from: { line: 0, ch: 0 },
						to: { line: 0, ch: 3 },
					},
				}),
			},
			vaultAccess,
			mentionService,
		);
		const res = r.agentContent.find((b) => b.type === "resource") as {
			resource: { text: string };
		};
		expect(res.resource.text).toBe("abcd");
	});

	it("embedded path leaves Windows paths unconverted when convertToWsl is omitted", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Note.md": "c",
		});
		const r = await preparePrompt(
			{
				...base,
				message: "@[[Note]]",
				vaultBasePath: "C:\\Users\\me\\vault",
				supportsEmbeddedContext: true,
			},
			vaultAccess,
			mentionService,
		);
		const res = r.agentContent.find((b) => b.type === "resource") as {
			resource: { uri: string };
		};
		expect(res.resource.uri).toBe("file:///C:/Users/me/vault/Note.md");
	});

	it("text-context auto-mention leaves Windows paths unconverted by default", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Active.md": "body",
		});
		const r = await preparePrompt(
			{
				...base,
				vaultBasePath: "C:\\Users\\me\\vault",
				supportsEmbeddedContext: false,
				activeNote: note(),
			},
			vaultAccess,
			mentionService,
		);
		// resolveAbsolutePath does NOT normalize backslashes without WSL mode
		expect(textBlocks(r.agentContent)[0]).toContain(
			"C:\\Users\\me\\vault/Active.md",
		);
	});

	it("embedded path: agentContent for a bare message is exactly one text block", async () => {
		const { vaultAccess, mentionService } = vaultWith({});
		const r = await preparePrompt(
			{ ...base, supportsEmbeddedContext: true },
			vaultAccess,
			mentionService,
		);
		expect(r.agentContent).toEqual([
			{ type: "text", text: "hello agent" },
		]);
	});

	it("embedded path: empty message with only an auto-mention prefix still emits the prefix block", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Active.md": "body",
		});
		const r = await preparePrompt(
			{
				...base,
				message: "",
				supportsEmbeddedContext: true,
				activeNote: note(),
			},
			vaultAccess,
			mentionService,
		);
		expect(textBlocks(r.agentContent)).toContain("@[[Active]]\n");
	});

	it("embedded path: images and resourceLinks land after the user text, in order", async () => {
		const { vaultAccess, mentionService } = vaultWith({});
		const img = {
			type: "image" as const,
			data: "aGk=",
			mimeType: "image/png",
		};
		const link = {
			type: "resource_link" as const,
			uri: "file:///vault/x.md",
			name: "x",
		};
		const r = await preparePrompt(
			{
				...base,
				supportsEmbeddedContext: true,
				images: [img],
				resourceLinks: [link],
			},
			vaultAccess,
			mentionService,
		);
		expect(r.agentContent).toEqual([
			{ type: "text", text: "hello agent" },
			img,
			link,
		]);
		expect(r.displayContent).toEqual([
			{ type: "text", text: "hello agent" },
			img,
			link,
		]);
	});

	it("badge survives a non-slash message on the text-context path", async () => {
		const { vaultAccess, mentionService } = vaultWith({
			"Active.md": "body",
		});
		const r = await preparePrompt(
			{ ...base, supportsEmbeddedContext: false, activeNote: note() },
			vaultAccess,
			mentionService,
		);
		expect(r.autoMentionContext).toEqual({
			noteName: "Active",
			notePath: "Active.md",
			selection: undefined,
		});
	});
});
