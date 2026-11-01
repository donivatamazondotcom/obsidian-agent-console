/**
 * I222 — each builder's "take one leading block" stripper removes exactly
 * what that builder emits, fed with the builder's OWN output (not a copied
 * literal), so a change to a builder that its stripper doesn't follow fails
 * here.
 */
import { describe, it, expect } from "vitest";

import { buildContextBlocks, takeLeadingContextBlock } from "../context-builder";
import { buildCarryOverBlocks, takeLeadingCarryOverBlock } from "../carry-over-builder";
import {
	buildTitleRubric,
	isPlaceholderAgentTitle,
	stripInjectedPromptText,
	takeLeadingSenderBlock,
} from "../message-sender";
import {
	adaptPromptForEngine,
	takeLeadingAttachedFile,
	takeTrailingAttachedFile,
} from "../../acp/kiro-v3";
import type { AgentConfig } from "../../acp/acp-client";
import type { ChatMessage, PromptContent } from "../../types/chat";

const WORDS = "what changed?";
const text = (b: PromptContent) => (b.type === "text" ? b.text : "");

describe("context-builder stripper", () => {
	for (const embedded of [false, true]) {
		it(`removes every text block buildContextBlocks emits (embedded=${embedded})`, () => {
			const blocks = buildContextBlocks({
				contextNotes: [{ path: "a/B.md", source: "user", seen: false }],
				selection: { path: "a/B.md", fromLine: 3, toLine: 9, text: "x" },
				useEmbeddedContext: embedded,
				vaultPath: "/v",
			}).filter((b) => b.type === "text");
			let rest = blocks.map(text).join("\n") + "\n" + WORDS;
			for (let next = takeLeadingContextBlock(rest); next !== null; next = takeLeadingContextBlock(rest)) {
				rest = next;
			}
			expect(rest).toBe(WORDS);
		});
	}
});

describe("carry-over-builder stripper", () => {
	const msgs: ChatMessage[] = [
		{ id: "1", role: "user", content: [{ type: "text", text: "old" }], timestamp: new Date() },
	];
	for (const embedded of [false, true]) {
		it(`removes the text block buildCarryOverBlocks emits (embedded=${embedded})`, () => {
			const blocks = buildCarryOverBlocks(msgs, embedded).filter((b) => b.type === "text");
			expect(blocks).toHaveLength(1);
			expect(takeLeadingCarryOverBlock(text(blocks[0]) + WORDS)).toBe(WORDS);
		});
	}
});

describe("message-sender stripper", () => {
	it("removes the title rubric, with and without the language line", () => {
		for (const replyLanguageName of [null, "Japanese"]) {
			const rubric = buildTitleRubric({
				isFirstMessage: true,
				titleStrategy: "agent-suggested",
				replyLanguageName,
			} as Parameters<typeof buildTitleRubric>[0]);
			expect(rubric).toBeTruthy();
			expect(takeLeadingSenderBlock(rubric + WORDS)).toBe(WORDS);
		}
	});

	it("leaves a head that is not an injected block alone", () => {
		expect(takeLeadingSenderBlock(WORDS)).toBeNull();
		expect(takeLeadingSenderBlock("<obsidian_system_instruction> unclosed")).toBeNull();
	});

	it("flags a V3 placeholder title, not a real one", () => {
		expect(isPlaceholderAgentTitle("<obsidian_system_instruction>")).toBe(true);
		expect(isPlaceholderAgentTitle("Kiro integration with Obsidian")).toBe(false);
	});
});

describe("kiro-v3 attached-file inverse", () => {
	const V3 = { kiroEngine: "v3" } as unknown as AgentConfig;
	const link = {
		type: "resource_link" as const,
		uri: "file:///v/report.pdf",
		name: "report.pdf",
		mimeType: "application/pdf",
	};
	const block = text(adaptPromptForEngine(V3, [link])[0]);

	it("round-trips adaptPromptForEngine's block at the head and the tail", () => {
		expect(takeLeadingAttachedFile(`${block}\n${WORDS}`)).toEqual({ rest: WORDS, link });
		expect(takeTrailingAttachedFile(`${WORDS}\n${block}`)).toEqual({ rest: WORDS, link });
	});

	it("does not touch a hand-typed tag without the plugin's hint", () => {
		const typed = '<attached_file name="x" uri="y">\nhello\n</attached_file>';
		expect(takeLeadingAttachedFile(typed)).toBeNull();
		expect(stripInjectedPromptText(typed).text).toBe(typed);
	});
});
