/**
 * Unit tests for ChatExporter (the "Export chat to Markdown" feature).
 *
 * Source: src/services/chat-exporter.ts
 *
 * Prior to this suite the exporter had ZERO logic coverage — the only test
 * references were stubbed `onExportChat={vi.fn()}` props passed to ChatHeader.
 * These tests pin the conversion + path-resolution behavior so regressions
 * surface before they reach the docs/export output users see.
 *
 * Strategy:
 *   - vi.mock("obsidian") provides a `TFile` class so the exporter's
 *     `instanceof TFile` checks resolve (mirrors vault-service.test.ts).
 *   - An in-memory fake `plugin.app` models vault / metadataCache /
 *     fileManager / workspace. No Obsidian runtime.
 *   - Timestamp assertions are computed from the SAME Date getters the
 *     exporter uses, so they validate substitution/padding wiring without
 *     being flaky across CI timezones.
 *
 * Coverage map:
 *   Path resolution (resolveExportFilePath via exportToMarkdown)
 *     E01  No existing file → base path, vault.create called
 *     E02  Existing file, same session_id → overwrite (vault.modify, base path)
 *     E03  Existing file, different session → _2 suffix
 *     E04  base + _2 both other sessions → _3
 *     E05  _2 belongs to our session → reuse _2 (modify)
 *   Frontmatter (generateFrontmatter)
 *     E06  Emits created/agentDisplayName/agentId/session_id
 *     E07  tags line present iff frontmatterTag is non-empty
 *   Filename templating (generateFileName)
 *     E08  {date}/{time} substituted with zero-padded local components
 *   Content conversion (convertContentToMarkdown)
 *     E09  text
 *     E10  text_with_context with selection → @[[note]]:from-to
 *     E11  text_with_context without selection → @[[note]]
 *     E12  agent_thought → info callout
 *     E13  tool_call new-file diff → all-`+` lines
 *     E14  tool_call modified-file diff → `-` old then `+` new
 *     E15  terminal → header with truncated id
 *     E16  plan → status glyphs
 *     E17  permission_request → Requested vs Cancelled
 *     E18  resource_link → markdown link
 *   Images (convertContentToMarkdown image branch)
 *     E19  includeImages:false → skipped
 *     E20  external uri → ![Image](uri)
 *     E21  base64 mode → data URI embed
 *     E22  obsidian mode → saveImageAsAttachment → ![[file]] + createBinary
 *   openFile flag
 *     E23  openFile:true opens the file; openFile:false does not
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("obsidian", () => {
	class TFile {
		path = "";
	}
	return { TFile };
});

import { TFile } from "obsidian";
import { ChatExporter } from "../chat-exporter";
import type { ChatMessage, MessageContent } from "../../types/chat";

// ============================================================================
// Fake Obsidian app / plugin
// ============================================================================

type ExportSettings = {
	defaultFolder: string;
	filenameTemplate: string;
	includeImages: boolean;
	imageLocation: "obsidian" | "custom" | "base64";
	imageCustomFolder: string;
	frontmatterTag: string;
};

function makeTFile(path: string): TFile {
	const f = new (TFile as unknown as { new (): TFile })();
	(f as { path: string }).path = path;
	return f;
}

interface FakeApp {
	created: Map<string, string>;
	modified: Map<string, string>;
	createBinary: ReturnType<typeof vi.fn>;
	createFolder: ReturnType<typeof vi.fn>;
	openFile: ReturnType<typeof vi.fn>;
	getAvailablePathForAttachment: ReturnType<typeof vi.fn>;
	app: unknown;
}

function makeFakeApp(opts?: {
	/** Pre-existing files: path -> session_id in frontmatter (null = no fm). */
	existing?: Record<string, string | null>;
}): FakeApp {
	const files = new Map<string, TFile>();
	const frontmatter = new Map<string, string | null>();
	for (const [p, sid] of Object.entries(opts?.existing ?? {})) {
		files.set(p, makeTFile(p));
		frontmatter.set(p, sid);
	}

	const created = new Map<string, string>();
	const modified = new Map<string, string>();
	const createBinary = vi.fn(async () => {});
	const createFolder = vi.fn(async () => {});
	const openFile = vi.fn(async () => {});
	const getAvailablePathForAttachment = vi.fn(
		async (name: string) => `Attachments/${name}`,
	);

	const vault = {
		getAbstractFileByPath: (path: string) => files.get(path) ?? null,
		createFolder,
		create: vi.fn(async (path: string, content: string) => {
			const f = makeTFile(path);
			files.set(path, f);
			created.set(path, content);
			return f;
		}),
		modify: vi.fn(async (file: TFile, content: string) => {
			modified.set((file as { path: string }).path, content);
		}),
		createBinary,
	};

	const metadataCache = {
		getFileCache: (file: TFile) => {
			const sid = frontmatter.get((file as { path: string }).path);
			return sid == null ? {} : { frontmatter: { session_id: sid } };
		},
	};

	const workspace = {
		getLeaf: () => ({ openFile }),
	};

	const fileManager = { getAvailablePathForAttachment };

	return {
		created,
		modified,
		createBinary,
		createFolder,
		openFile,
		getAvailablePathForAttachment,
		app: { vault, metadataCache, workspace, fileManager },
	};
}

function makePlugin(fake: FakeApp, settings?: Partial<ExportSettings>) {
	const exportSettings: ExportSettings = {
		defaultFolder: "Agent Console",
		filenameTemplate: "agent_console_{date}_{time}",
		includeImages: true,
		imageLocation: "obsidian",
		imageCustomFolder: "Agent Console",
		frontmatterTag: "agent-client",
		...settings,
	};
	return {
		app: fake.app,
		settings: { exportSettings },
	} as unknown as ConstructorParameters<typeof ChatExporter>[0];
}

// ============================================================================
// Fixtures
// ============================================================================

const TS = new Date(2026, 0, 15, 1, 23, 45); // local time; 2026-01-15 01:23:45

function userMsg(content: MessageContent[]): ChatMessage {
	return { id: "u1", role: "user", content, timestamp: TS };
}

function assistantMsg(content: MessageContent[]): ChatMessage {
	return { id: "a1", role: "assistant", content, timestamp: TS };
}

/** Run an export and return the markdown content that was written. */
async function exportAndRead(
	messages: ChatMessage[],
	opts?: {
		settings?: Partial<ExportSettings>;
		existing?: Record<string, string | null>;
		sessionId?: string;
		openFile?: boolean;
	},
): Promise<{ path: string; content: string; fake: FakeApp }> {
	const fake = makeFakeApp({ existing: opts?.existing });
	const plugin = makePlugin(fake, opts?.settings);
	const exporter = new ChatExporter(plugin);
	const path = await exporter.exportToMarkdown(
		messages,
		"Claude Code",
		"claude-code-acp",
		opts?.sessionId ?? "sess-1",
		TS,
		opts?.openFile ?? false,
	);
	const content = fake.created.get(path) ?? fake.modified.get(path) ?? "";
	return { path, content, fake };
}

// Date components computed the SAME way the exporter does (local tz).
const Y = TS.getFullYear();
const MO = String(TS.getMonth() + 1).padStart(2, "0");
const D = String(TS.getDate()).padStart(2, "0");
const H = String(TS.getHours()).padStart(2, "0");
const MI = String(TS.getMinutes()).padStart(2, "0");
const SE = String(TS.getSeconds()).padStart(2, "0");
const DATE_STR = `${Y}${MO}${D}`;
const TIME_STR = `${H}${MI}${SE}`;

describe("ChatExporter — path resolution", () => {
	it("E01: no existing file → base path, vault.create called", async () => {
		const { path, fake } = await exportAndRead([userMsg([{ type: "text", text: "hi" }])]);
		expect(path).toBe(`Agent Console/agent_console_${DATE_STR}_${TIME_STR}.md`);
		expect(fake.created.has(path)).toBe(true);
	});

	it("E02: existing file, same session_id → overwrite at base path", async () => {
		const base = `Agent Console/agent_console_${DATE_STR}_${TIME_STR}.md`;
		const { path, fake } = await exportAndRead(
			[userMsg([{ type: "text", text: "hi" }])],
			{ existing: { [base]: "sess-1" }, sessionId: "sess-1" },
		);
		expect(path).toBe(base);
		expect(fake.modified.has(base)).toBe(true);
		expect(fake.created.has(base)).toBe(false);
	});

	it("E03: existing file, different session → _2 suffix", async () => {
		const base = `Agent Console/agent_console_${DATE_STR}_${TIME_STR}.md`;
		const { path } = await exportAndRead(
			[userMsg([{ type: "text", text: "hi" }])],
			{ existing: { [base]: "other-session" }, sessionId: "sess-1" },
		);
		expect(path).toBe(`Agent Console/agent_console_${DATE_STR}_${TIME_STR}_2.md`);
	});

	it("E04: base and _2 both other sessions → _3", async () => {
		const b = `Agent Console/agent_console_${DATE_STR}_${TIME_STR}`;
		const { path } = await exportAndRead(
			[userMsg([{ type: "text", text: "hi" }])],
			{
				existing: { [`${b}.md`]: "other-a", [`${b}_2.md`]: "other-b" },
				sessionId: "sess-1",
			},
		);
		expect(path).toBe(`${b}_3.md`);
	});

	it("E05: _2 belongs to our session → reuse and overwrite _2", async () => {
		const b = `Agent Console/agent_console_${DATE_STR}_${TIME_STR}`;
		const { path, fake } = await exportAndRead(
			[userMsg([{ type: "text", text: "hi" }])],
			{
				existing: { [`${b}.md`]: "other-a", [`${b}_2.md`]: "sess-1" },
				sessionId: "sess-1",
			},
		);
		expect(path).toBe(`${b}_2.md`);
		expect(fake.modified.has(`${b}_2.md`)).toBe(true);
	});
});

describe("ChatExporter — frontmatter", () => {
	it("E06: emits created/agentDisplayName/agentId/session_id", async () => {
		const { content } = await exportAndRead(
			[userMsg([{ type: "text", text: "hi" }])],
			{ sessionId: "sess-xyz" },
		);
		expect(content).toContain(`created: ${Y}-${MO}-${D}T${H}:${MI}:${SE}`);
		expect(content).toContain("agentDisplayName: Claude Code");
		expect(content).toContain("agentId: claude-code-acp");
		expect(content).toContain("session_id: sess-xyz");
	});

	it("E07: tags line present iff frontmatterTag is non-empty", async () => {
		const withTag = await exportAndRead(
			[userMsg([{ type: "text", text: "hi" }])],
			{ settings: { frontmatterTag: "agent-client" } },
		);
		expect(withTag.content).toContain("tags: [agent-client]");

		const noTag = await exportAndRead(
			[userMsg([{ type: "text", text: "hi" }])],
			{ settings: { frontmatterTag: "  " } },
		);
		expect(noTag.content).not.toContain("tags:");
	});
});

describe("ChatExporter — filename templating", () => {
	it("E08: {date}/{time} substituted with zero-padded local components", async () => {
		const { path } = await exportAndRead(
			[userMsg([{ type: "text", text: "hi" }])],
			{ settings: { filenameTemplate: "chat_{date}_{time}" } },
		);
		expect(path).toBe(`Agent Console/chat_${DATE_STR}_${TIME_STR}.md`);
	});
});

describe("ChatExporter — content conversion", () => {
	it("E09: text content", async () => {
		const { content } = await exportAndRead([userMsg([{ type: "text", text: "hello world" }])]);
		expect(content).toContain("hello world");
	});

	it("E10: text_with_context with selection → @[[note]]:from-to", async () => {
		const { content } = await exportAndRead([
			userMsg([
				{
					type: "text_with_context",
					text: "please review",
					autoMentionContext: {
						noteName: "My Note",
						notePath: "My Note.md",
						selection: { fromLine: 3, toLine: 7 },
					},
				},
			]),
		]);
		expect(content).toContain("@[[My Note]]:3-7");
		expect(content).toContain("please review");
	});

	it("E11: text_with_context without selection → @[[note]]", async () => {
		const { content } = await exportAndRead([
			userMsg([
				{
					type: "text_with_context",
					text: "context only",
					autoMentionContext: { noteName: "My Note", notePath: "My Note.md" },
				},
			]),
		]);
		expect(content).toContain("@[[My Note]]");
		expect(content).not.toContain("@[[My Note]]:");
	});

	it("E12: agent_thought → info callout", async () => {
		const { content } = await exportAndRead([
			assistantMsg([{ type: "agent_thought", text: "line1\nline2" }]),
		]);
		expect(content).toContain("> [!info]- Thinking");
		expect(content).toContain("> line1");
		expect(content).toContain("> line2");
	});

	it("E13: tool_call new-file diff → all-+ lines", async () => {
		const { content } = await exportAndRead([
			assistantMsg([
				{
					type: "tool_call",
					toolCallId: "t1",
					title: "Write file",
					status: "completed",
					content: [
						{ type: "diff", path: "a.ts", oldText: null, newText: "const x = 1;\nconst y = 2;" },
					],
				},
			]),
		]);
		expect(content).toContain("### 🔧 Write file");
		expect(content).toContain("**Status**: completed");
		expect(content).toContain("+ const x = 1;");
		expect(content).toContain("+ const y = 2;");
		expect(content).not.toContain("- const x = 1;");
	});

	it("E14: tool_call modified-file diff → - old then + new", async () => {
		const { content } = await exportAndRead([
			assistantMsg([
				{
					type: "tool_call",
					toolCallId: "t2",
					title: "Edit file",
					status: "completed",
					locations: [{ path: "a.ts", line: 10 }],
					content: [{ type: "diff", path: "a.ts", oldText: "old", newText: "new" }],
				},
			]),
		]);
		expect(content).toContain("**Locations**: `a.ts:10`");
		expect(content).toContain("- old");
		expect(content).toContain("+ new");
	});

	it("E15: terminal → header with truncated id", async () => {
		const { content } = await exportAndRead([
			assistantMsg([{ type: "terminal", terminalId: "abcdef1234567890" }]),
		]);
		expect(content).toContain("### 🖥️ Terminal: abcdef12");
	});

	it("E16: plan → status glyphs", async () => {
		const { content } = await exportAndRead([
			assistantMsg([
				{
					type: "plan",
					entries: [
						{ content: "done task", status: "completed", priority: "medium" },
						{ content: "doing task", status: "in_progress", priority: "medium" },
						{ content: "todo task", status: "pending", priority: "medium" },
					],
				} as unknown as MessageContent,
			]),
		]);
		expect(content).toContain("> [!plan] Plan");
		expect(content).toContain("✅ done task");
		expect(content).toContain("🔄 doing task");
		expect(content).toContain("⏳ todo task");
	});

	it("E17: permission_request → Requested vs Cancelled", async () => {
		const requested = await exportAndRead([
			assistantMsg([
				{
					type: "permission_request",
					toolCall: { toolCallId: "p1", title: "Run command" },
					options: [],
					isCancelled: false,
				} as unknown as MessageContent,
			]),
		]);
		expect(requested.content).toContain("### ⚠️ Permission: Run command (Requested)");

		const cancelled = await exportAndRead([
			assistantMsg([
				{
					type: "permission_request",
					toolCall: { toolCallId: "p2", title: "Run command" },
					options: [],
					isCancelled: true,
				} as unknown as MessageContent,
			]),
		]);
		expect(cancelled.content).toContain("(Cancelled)");
	});

	it("E18: resource_link → markdown link", async () => {
		const { content } = await exportAndRead([
			assistantMsg([
				{ type: "resource_link", name: "spec.pdf", uri: "file:///spec.pdf" },
			]),
		]);
		expect(content).toContain("[spec.pdf](file:///spec.pdf)");
	});
});

describe("ChatExporter — images", () => {
	const base64png = "iVBORw0KGgo="; // short valid base64

	it("E19: includeImages:false → image skipped", async () => {
		const { content, fake } = await exportAndRead(
			[assistantMsg([{ type: "image", data: base64png, mimeType: "image/png" }])],
			{ settings: { includeImages: false } },
		);
		expect(content).not.toContain("![");
		expect(fake.createBinary).not.toHaveBeenCalled();
	});

	it("E20: external uri → ![Image](uri)", async () => {
		const { content } = await exportAndRead([
			assistantMsg([
				{ type: "image", data: "", mimeType: "image/png", uri: "https://x/y.png" },
			]),
		]);
		expect(content).toContain("![Image](https://x/y.png)");
	});

	it("E21: base64 mode → data URI embed", async () => {
		const { content, fake } = await exportAndRead(
			[assistantMsg([{ type: "image", data: base64png, mimeType: "image/png" }])],
			{ settings: { imageLocation: "base64" } },
		);
		expect(content).toContain(`![Image](data:image/png;base64,${base64png})`);
		expect(fake.createBinary).not.toHaveBeenCalled();
	});

	it("E22: obsidian mode → saveImageAsAttachment → ![[file]] + createBinary", async () => {
		const { content, fake } = await exportAndRead(
			[assistantMsg([{ type: "image", data: base64png, mimeType: "image/png" }])],
			{ settings: { imageLocation: "obsidian" } },
		);
		expect(fake.getAvailablePathForAttachment).toHaveBeenCalled();
		expect(fake.createBinary).toHaveBeenCalledTimes(1);
		expect(content).toMatch(/!\[\[.*\.png\]\]/);
	});
});

describe("ChatExporter — openFile flag", () => {
	it("E23: openFile true opens the file, false does not", async () => {
		const open = await exportAndRead([userMsg([{ type: "text", text: "hi" }])], {
			openFile: true,
		});
		expect(open.fake.openFile).toHaveBeenCalledTimes(1);

		const noOpen = await exportAndRead([userMsg([{ type: "text", text: "hi" }])], {
			openFile: false,
		});
		expect(noOpen.fake.openFile).not.toHaveBeenCalled();
	});
});
