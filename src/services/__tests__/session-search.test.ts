import { describe, it, expect } from "vitest";
import {
	extractMessageText,
	buildIndexEntry,
	makeSnippet,
	searchSessions,
	type SessionIndexEntry,
} from "../session-search";
import type { ChatMessage } from "../../types/chat";
import type { SessionInfo } from "../../types/session";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msg(
	role: "user" | "assistant",
	content: ChatMessage["content"],
	id = Math.random().toString(36).slice(2),
): ChatMessage {
	return { id, role, content, timestamp: new Date() };
}

function text(role: "user" | "assistant", body: string): ChatMessage {
	return msg(role, [{ type: "text", text: body }]);
}

function session(sessionId: string, title?: string, updatedAt?: string): SessionInfo {
	return { sessionId, cwd: "/vault", title, updatedAt };
}

function indexOf(
	sessionId: string,
	messages: ChatMessage[],
	opts?: Parameters<typeof buildIndexEntry>[2],
): [string, SessionIndexEntry] {
	return [sessionId, buildIndexEntry(sessionId, messages, opts)];
}

// ---------------------------------------------------------------------------
// extractMessageText
// ---------------------------------------------------------------------------

describe("extractMessageText", () => {
	it("extracts text, text_with_context, and agent_thought by default", () => {
		const m = msg("assistant", [
			{ type: "text", text: "hello" },
			{ type: "text_with_context", text: "world" },
			{ type: "agent_thought", text: "thinking" },
		]);
		expect(extractMessageText(m)).toBe("hello world thinking");
	});

	it("excludes agent_thought when includeThoughts=false", () => {
		const m = msg("assistant", [
			{ type: "text", text: "hello" },
			{ type: "agent_thought", text: "secret reasoning" },
		]);
		expect(extractMessageText(m, { includeThoughts: false })).toBe("hello");
	});

	it("excludes tool_call text by default but includes it when enabled (T06)", () => {
		const m = msg("assistant", [
			{
				type: "tool_call",
				toolCallId: "t1",
				title: "grep wikilink",
				status: "completed",
				rawInput: { pattern: "wikilink" },
			},
		]);
		expect(extractMessageText(m)).toBe("");
		const withTools = extractMessageText(m, { includeToolCalls: true });
		expect(withTools).toContain("grep wikilink");
		expect(withTools).toContain("wikilink");
	});

	it("skips non-textual blocks (image, terminal)", () => {
		const m = msg("user", [
			{ type: "text", text: "see this" },
			{ type: "image", data: "BASE64==", mimeType: "image/png" },
			{ type: "terminal", terminalId: "term1" },
		]);
		expect(extractMessageText(m)).toBe("see this");
	});

	it("indexes resource_link names and plan entry content", () => {
		const m = msg("assistant", [
			{ type: "resource_link", uri: "file:///a.pdf", name: "spec.pdf" },
			{
				type: "plan",
				entries: [
					{ content: "step one", status: "pending", priority: "high" },
				],
			},
		]);
		const out = extractMessageText(m);
		expect(out).toContain("spec.pdf");
		expect(out).toContain("step one");
	});
});

// ---------------------------------------------------------------------------
// makeSnippet
// ---------------------------------------------------------------------------

describe("makeSnippet (T03)", () => {
	it("centers on the first match and reports highlight offsets", () => {
		const body =
			"the quick brown fox jumps over the lazy dog and then keeps running far";
		const snip = makeSnippet(body, "fox", 5);
		expect(snip).not.toBeNull();
		const sliceMatch = snip!.text.slice(
			snip!.matchStart,
			snip!.matchStart + snip!.matchLength,
		);
		expect(sliceMatch.toLowerCase()).toBe("fox");
	});

	it("is case-insensitive", () => {
		const snip = makeSnippet("Wikilink resolution failed", "WIKILINK", 100);
		expect(snip).not.toBeNull();
		expect(snip!.matchStart).toBe(0);
	});

	it("adds ellipsis when truncated and none at boundaries", () => {
		const head = makeSnippet("alpha beta gamma", "alpha", 3);
		expect(head!.text.startsWith("…")).toBe(false);
		const mid = makeSnippet(
			"xxxxxxxxxxxxxxxx needle yyyyyyyyyyyyyyyy",
			"needle",
			3,
		);
		expect(mid!.text.startsWith("…")).toBe(true);
		expect(mid!.text.endsWith("…")).toBe(true);
	});

	it("returns null when the query is absent or empty", () => {
		expect(makeSnippet("nothing here", "missing")).toBeNull();
		expect(makeSnippet("nothing here", "")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// searchSessions
// ---------------------------------------------------------------------------

describe("searchSessions", () => {
	it("T01: matches titles case-insensitively", () => {
		const sessions = [
			session("a", "Debugging the Wikilink issue"),
			session("b", "Travel planning"),
		];
		const results = searchSessions("wikilink", sessions, new Map());
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({ sessionId: "a", matchKind: "title" });
	});

	it("T02: finds a session whose body matches but title does not", () => {
		const sessions = [session("a", "Untitled session")];
		const index = new Map([
			indexOf("a", [
				text("user", "how do I fix the wikilink resolution bug"),
			]),
		]);
		const results = searchSessions("wikilink", sessions, index);
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			sessionId: "a",
			matchKind: "content",
		});
		expect(results[0].snippet?.text.toLowerCase()).toContain("wikilink");
	});

	it("T04: returns empty when nothing matches", () => {
		const sessions = [session("a", "Travel")];
		const index = new Map([indexOf("a", [text("user", "flights to BLR")])]);
		expect(searchSessions("kubernetes", sessions, index)).toHaveLength(0);
	});

	it("T05: title matches rank above content-only; input order preserved within tier", () => {
		// sessions arrive in recency order (caller sorts by updatedAt desc).
		const sessions = [
			session("c1", "Untitled"), // content match only
			session("t1", "wikilink notes"), // title match
			session("c2", "Another untitled"), // content match only
			session("t2", "more wikilink stuff"), // title match
		];
		const index = new Map([
			indexOf("c1", [text("user", "discussed wikilink earlier")]),
			indexOf("c2", [text("assistant", "the wikilink graph updates")]),
		]);
		const results = searchSessions("wikilink", sessions, index);
		expect(results.map((r) => r.sessionId)).toEqual([
			"t1",
			"t2",
			"c1",
			"c2",
		]);
		expect(results.slice(0, 2).every((r) => r.matchKind === "title")).toBe(
			true,
		);
	});

	it("does not duplicate a session that matches on both title and content", () => {
		const sessions = [session("a", "wikilink session")];
		const index = new Map([
			indexOf("a", [text("user", "wikilink in the body too")]),
		]);
		const results = searchSessions("wikilink", sessions, index);
		expect(results).toHaveLength(1);
		expect(results[0].matchKind).toBe("title");
	});

	it("empty query returns the full list as title matches in input order", () => {
		const sessions = [session("a", "one"), session("b", "two")];
		const results = searchSessions("   ", sessions, new Map());
		expect(results.map((r) => r.sessionId)).toEqual(["a", "b"]);
		expect(results.every((r) => r.matchKind === "title")).toBe(true);
	});

	it("content tier contributes nothing for sessions missing from a partial index", () => {
		// Simulates the index still building: title tier works, content tier empty.
		const sessions = [session("a", "Untitled")];
		const results = searchSessions("wikilink", sessions, new Map());
		expect(results).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// buildIndexEntry
// ---------------------------------------------------------------------------

describe("buildIndexEntry", () => {
	it("lowercases the haystack and drops empty messages", () => {
		const entry = buildIndexEntry("a", [
			text("user", "Hello WORLD"),
			msg("assistant", [{ type: "image", data: "x", mimeType: "image/png" }]),
		]);
		expect(entry.haystack).toBe("hello world");
		expect(entry.messages).toHaveLength(1);
	});
});
