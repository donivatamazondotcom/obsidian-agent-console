/**
 * I222 / I228 (a, a3) — reproduce-first: a replayed user message shows only
 * the user's words.
 *
 * On `session/load` the agent replays the prompt it RECEIVED, which includes
 * every block the plugin injected around the user's text: the
 * `<obsidian_system_instruction>` briefing, the bare F03 title rubric, context
 * notes, the selection hint, and (Kiro V3 only, I220) `<attached_file>` text
 * blocks standing in for resource links.
 *
 * Wire shapes, traced live 2026-11-01 (see I228 note § Trace):
 *  - Claude Code replays each text block as its OWN `user_message_chunk`.
 *  - Kiro CLI V3 replays ONE chunk: all text blocks joined with "\n".
 *
 * The prompt under test is built by the REAL `preparePrompt` (and, for V3,
 * the real `adaptPromptForEngine`), so the test tracks the builders: change a
 * wrapper and this test still feeds the new wrapper through the boundary.
 * Entry seam: `applySingleUpdate`, the one place replayed user text enters
 * message state.
 */
import { describe, it, expect } from "vitest";

import { preparePrompt, type PreparePromptInput } from "../message-sender";
import { applySingleUpdate } from "../message-state";
import { adaptPromptForEngine } from "../../acp/kiro-v3";
import type { AgentConfig } from "../../acp/acp-client";
import type { ChatMessage, PromptContent } from "../../types/chat";
import type { IVaultAccess } from "../vault-service";
import type { IMentionService } from "../../utils/mention-parser";

const USER_WORDS = "Summarize the release plan in two bullets";

const vaultAccess = {
	readNote: async () => "line one\nline two\nline three",
} as unknown as IVaultAccess;
const mentionService = {
	getAllFiles: () => [],
	getFileByPath: () => null,
} as unknown as IMentionService;

function baseInput(embedded: boolean): PreparePromptInput {
	return {
		message: USER_WORDS,
		vaultBasePath: "/vault",
		workingDirectory: "/vault",
		vaultRootPath: "/vault",
		isFirstMessage: true,
		titleStrategy: "agent-suggested",
		replyLanguageName: "English",
		supportsEmbeddedContext: embedded,
		contextNotes: [{ path: "Plans/Release.md", source: "user", seen: false }],
		selectionContext: {
			path: "Plans/Release.md",
			fromLine: 2,
			toLine: 3,
			text: "line two\nline three",
		},
	};
}

async function agentContent(embedded: boolean): Promise<PromptContent[]> {
	const prepared = await preparePrompt(
		baseInput(embedded),
		vaultAccess,
		mentionService,
	);
	return prepared.agentContent;
}

function textBlocks(content: PromptContent[]): string[] {
	return content.flatMap((b) => (b.type === "text" ? [b.text] : []));
}

/** Feed replayed chunks through the message-state boundary. */
function replay(chunks: string[]): ChatMessage[] {
	let messages: ChatMessage[] = [];
	const index = new Map<string, number>();
	for (const text of chunks) {
		messages = applySingleUpdate(
			messages,
			{ type: "user_message_chunk", sessionId: "s1", text },
			index,
		);
	}
	messages = applySingleUpdate(
		messages,
		{ type: "agent_message_chunk", sessionId: "s1", text: "Sure." },
		index,
	);
	return messages;
}

function userText(messages: ChatMessage[]): string {
	const user = messages.find((m) => m.role === "user");
	return (user?.content ?? [])
		.map((b) => (b.type === "text" ? b.text : ""))
		.join("");
}

const V3: AgentConfig = { kiroEngine: "v3" } as unknown as AgentConfig;

describe("I222/I228 — replayed user message shows only the user's words", () => {
	it("(a) Claude shape — one chunk per text block, text-context agent", async () => {
		const blocks = textBlocks(await agentContent(false));
		expect(blocks.length).toBeGreaterThan(1); // sanity: wrappers were injected
		const messages = replay(blocks);
		expect(userText(messages)).toBe(USER_WORDS);
	});

	it("(a) Claude shape — one chunk per text block, embedded-context agent", async () => {
		const blocks = textBlocks(await agentContent(true));
		const messages = replay(blocks);
		expect(userText(messages)).toBe(USER_WORDS);
	});

	it("(a) a wrapper split across two chunks is still removed", async () => {
		const blocks = textBlocks(await agentContent(false));
		const first = blocks[0];
		const mid = Math.floor(first.length / 2);
		const messages = replay([
			first.slice(0, mid),
			first.slice(mid),
			...blocks.slice(1),
		]);
		expect(userText(messages)).toBe(USER_WORDS);
	});

	it("(a) Kiro V3 shape — one chunk, text blocks joined with newlines", async () => {
		const adapted = adaptPromptForEngine(V3, await agentContent(true));
		const messages = replay([textBlocks(adapted).join("\n")]);
		expect(userText(messages)).toBe(USER_WORDS);
	});

	it("(a3) Kiro V3 — a replayed <attached_file> comes back as a file chip, not raw text", async () => {
		const content: PromptContent[] = [
			...(await agentContent(true)),
			{
				type: "resource_link",
				uri: "file:///vault/Attachments/budget.xlsx",
				name: "budget.xlsx",
				mimeType:
					"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			},
		];
		const adapted = adaptPromptForEngine(V3, content);
		const messages = replay([textBlocks(adapted).join("\n")]);
		const user = messages.find((m) => m.role === "user");

		expect(userText(messages)).toBe(USER_WORDS);
		expect(userText(messages)).not.toContain("<attached_file");
		const links = (user?.content ?? []).filter(
			(b) => b.type === "resource_link",
		);
		expect(links).toEqual([
			expect.objectContaining({
				type: "resource_link",
				name: "Release", // buildContextBlocks displayName drops the extension
				uri: "file:///vault/Plans/Release.md",
			}),
			expect.objectContaining({
				type: "resource_link",
				name: "budget.xlsx",
				uri: "file:///vault/Attachments/budget.xlsx",
			}),
		]);
	});

	it("(I242) Claude shape with a context chip — the [@file](uri) mention comes back as a chip", async () => {
		// Claude Code stores each resource_link as the text `[@<basename>](<uri>)`
		// and replays it as its own chunk, in prompt order (trace 2026-11-01).
		const claudeChunks = (await agentContent(true)).flatMap((b) => {
			if (b.type === "text") return [b.text];
			if (b.type === "resource_link") {
				const base = decodeURI(b.uri).split("/").pop();
				return [`[@${base}](${b.uri})`];
			}
			return [];
		});
		claudeChunks.push("[@budget.xlsx](file:///vault/Attachments/budget.xlsx)");
		const messages = replay(claudeChunks);
		const user = messages.find((m) => m.role === "user");

		expect(userText(messages)).toBe(USER_WORDS);
		expect(
			(user?.content ?? []).filter((b) => b.type === "resource_link"),
		).toEqual([
			expect.objectContaining({ name: "Release.md", uri: "file:///vault/Plans/Release.md" }),
			expect.objectContaining({ name: "budget.xlsx", uri: "file:///vault/Attachments/budget.xlsx" }),
		]);
	});

	it("keeps the user's own words when they merely mention a tag name", () => {
		const own = "Why does <obsidian_system_instruction> show in my chat?";
		const messages = replay([own]);
		expect(userText(messages)).toBe(own);
	});
});
