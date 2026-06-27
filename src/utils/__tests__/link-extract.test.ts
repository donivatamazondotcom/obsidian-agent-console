/**
 * Tests for the Shared Links extractor (spec [[Shared Links Bubble]] § Test Cases).
 *
 * Pure function over ChatMessage[] — no Obsidian runtime needed. Covers:
 *   T1 mixed extraction + new/old classification
 *   T2 dedup
 *   T3 edited-not-created is "old"
 *   plus external/internal markdown links, bare-URL dedup, resource_link,
 *   user-message exclusion, and determinism (restart/replay parity).
 */
import { describe, it, expect } from "vitest";
import { extractLinks } from "../link-extract";
import type { ChatMessage, MessageContent } from "../../types/chat";

let seq = 0;
function msg(
	role: "assistant" | "user",
	content: MessageContent[],
): ChatMessage {
	return { id: `m${seq++}`, role, content, timestamp: new Date() };
}
function text(t: string): MessageContent {
	return { type: "text", text: t };
}
function createdDiff(path: string): MessageContent {
	return {
		type: "tool_call",
		toolCallId: `tc-${path}`,
		status: "completed",
		kind: "edit",
		content: [{ type: "diff", path, newText: "hello", oldText: null }],
	};
}
function editedDiff(path: string): MessageContent {
	return {
		type: "tool_call",
		toolCallId: `tc-${path}`,
		status: "completed",
		kind: "edit",
		content: [{ type: "diff", path, newText: "new", oldText: "old" }],
	};
}

describe("extractLinks", () => {
	it("T1: extracts mixed links and marks agent-created files new", () => {
		const messages = [
			msg("assistant", [
				text("See [[A]] and https://example.com/docs for context."),
			]),
			msg("assistant", [
				createdDiff("04-initiatives/Agent Console/B.md"),
			]),
			msg("assistant", [text("Wrote [[B]] for you.")]),
		];

		const links = extractLinks(messages);
		const byLabel = Object.fromEntries(links.map((l) => [l.label, l]));

		expect(links).toHaveLength(3);
		expect(byLabel["B"].kind).toBe("internal");
		expect(byLabel["B"].isNew).toBe(true);
		expect(byLabel["A"].isNew).toBe(false);
		expect(byLabel["https://example.com/docs"].kind).toBe("external");
		expect(byLabel["https://example.com/docs"].isNew).toBe(false);
	});

	it("T2: dedups repeated links and keeps the most-recent order", () => {
		const messages = [
			msg("assistant", [text("first [[A]]")]),
			msg("assistant", [text("again [[A]]")]),
			msg("assistant", [text("third time [[A]]")]),
		];
		const links = extractLinks(messages);
		expect(links).toHaveLength(1);
		expect(links[0].label).toBe("A");
		expect(links[0].order).toBe(2);
	});

	it("T3: a file the agent only edited (oldText present) is old, not new", () => {
		const messages = [
			msg("assistant", [editedDiff("notes/C.md")]),
			msg("assistant", [text("Updated [[C]].")]),
		];
		const links = extractLinks(messages);
		expect(links).toHaveLength(1);
		expect(links[0].label).toBe("C");
		expect(links[0].isNew).toBe(false);
	});

	it("classifies markdown links internal vs external by protocol", () => {
		const messages = [
			msg("assistant", [
				text(
					"[the spec](04-initiatives/spec.md) and [site](https://aws.amazon.com)",
				),
			]),
		];
		const links = extractLinks(messages);
		const internal = links.find((l) => l.label === "the spec");
		const external = links.find((l) => l.label === "site");
		expect(internal?.kind).toBe("internal");
		expect(external?.kind).toBe("external");
		expect(external?.target).toBe("https://aws.amazon.com");
	});

	it("does not double-count a URL captured as a markdown link", () => {
		const messages = [
			msg("assistant", [text("[docs](https://example.com/x)")]),
		];
		const links = extractLinks(messages);
		expect(links).toHaveLength(1);
		expect(links[0].label).toBe("docs");
	});

	it("strips a trailing backtick from an inline-code-wrapped bare URL", () => {
		const messages = [
			msg("assistant", [text("see `https://obsidian.md` for docs")]),
		];
		const links = extractLinks(messages);
		expect(links).toHaveLength(1);
		expect(links[0].target).toBe("https://obsidian.md");
		expect(links[0].label).toBe("https://obsidian.md");
	});
	it("SLB-I9: strips trailing markdown bold/italic markers from a bare URL", () => {
		const messages = [
			msg("assistant", [
				text(
					"PR is up: **https://github.com/donivatamazondotcom/obsidian-agent-console/pull/131**",
				),
			]),
		];
		const links = extractLinks(messages);
		expect(links).toHaveLength(1);
		expect(links[0].kind).toBe("external");
		// The closing ** must NOT be swallowed into the href (it 404s).
		expect(links[0].target).toBe(
			"https://github.com/donivatamazondotcom/obsidian-agent-console/pull/131",
		);
		expect(links[0].label).toBe(links[0].target);
	});

	it("captures resource_link blocks and matches agent-created files", () => {
		const messages = [
			msg("assistant", [createdDiff("/abs/vault/Report.md")]),
			msg("assistant", [
				{
					type: "resource_link",
					uri: "file:///abs/vault/Report.md",
					name: "Report.md",
				},
			]),
		];
		const links = extractLinks(messages);
		expect(links).toHaveLength(1);
		expect(links[0].kind).toBe("internal");
		expect(links[0].isNew).toBe(true);
	});

	it("ignores links in user messages (only the agent's links count)", () => {
		const messages = [
			msg("user", [text("look at [[MyNote]] please")]),
			msg("assistant", [text("ok, see [[AgentNote]]")]),
		];
		const links = extractLinks(messages);
		expect(links).toHaveLength(1);
		expect(links[0].label).toBe("AgentNote");
	});

	it("resolves wikilink alias and section for label/target", () => {
		const messages = [
			msg("assistant", [text("jump to [[Long Note#Heading|Go]]")]),
		];
		const links = extractLinks(messages);
		expect(links[0].label).toBe("Go");
		expect(links[0].target).toBe("Long Note#Heading");
	});

	it("T4: extraction is deterministic across identical (replayed) input", () => {
		const build = () => [
			msg("assistant", [text("[[A]] https://x.test")]),
			msg("assistant", [createdDiff("B.md")]),
			msg("assistant", [text("[[B]]")]),
		];
		seq = 0;
		const a = extractLinks(build());
		seq = 0;
		const b = extractLinks(build());
		expect(a).toEqual(b);
	});
});

describe("extractLinks — SLB-I8: resolve internal links against the vault", () => {
	it("drops non-resolving internal wikilinks (illustrative links), keeps externals and real notes", () => {
		const messages = [
			msg("assistant", [
				text(
					"see [[Agent Console]], an example [[file]], and [[TP-I05 …]]",
				),
			]),
			msg("assistant", [text("external https://example.com/x stays")]),
		];
		// Only the real note resolves in the vault.
		const resolveInternal = (lp: string) => lp.trim() === "Agent Console";
		const links = extractLinks(messages, { resolveInternal });
		const labels = links.map((l) => l.label);

		expect(labels).toContain("Agent Console"); // resolves → kept
		expect(labels).toContain("https://example.com/x"); // external → always kept
		expect(labels).not.toContain("file"); // [[file]] doesn't resolve → dropped
		expect(links.some((l) => l.target.includes("TP-I05"))).toBe(false); // [[TP-I05 …]] dropped
	});

	it("keeps an agent-created file even when the resolver says it doesn't exist yet (index timing)", () => {
		const messages = [
			msg("assistant", [createdDiff("01-inbox/New Note.md")]),
			msg("assistant", [text("created [[New Note]] for you")]),
		];
		const resolveInternal = () => false; // metadata cache hasn't indexed it
		const links = extractLinks(messages, { resolveInternal });
		expect(links).toHaveLength(1);
		expect(links[0].label).toBe("New Note");
		expect(links[0].isNew).toBe(true);
	});

	it("without a resolver, keeps all internal links (back-compat)", () => {
		const links = extractLinks([msg("assistant", [text("[[whatever]]")])]);
		expect(links).toHaveLength(1);
	});
});
