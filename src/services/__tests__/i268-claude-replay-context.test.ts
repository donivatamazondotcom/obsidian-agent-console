import { describe, it, expect } from "vitest";
import { applySingleUpdate } from "../message-state";
import type { ChatMessage } from "../../types/chat";
import { TITLE_RUBRIC } from "../../utils/system-instructions";

/**
 * I268: Claude Code stores an embedded `resource` block as a `[@name](uri)`
 * mention (in prompt order) plus a `\n<context ref="uri">…</context>` block
 * appended after all other content, and replays each as its own
 * `user_message_chunk` on session/load. Shapes traced live against
 * claude-agent-acp (ST-context-note-hydration, 2026-11-02).
 */

const A = "file:///vault/Hydration/Small note.md";
const B = "file:///vault/Hydration/Other note.md";
const RUBRIC = TITLE_RUBRIC;

function context(uri: string, body: string): string {
	return `\n<context ref="${uri}">\n${body}\n</context>`;
}

function replay(chunks: string[]): ChatMessage {
	let messages: ChatMessage[] = [];
	const index = new Map<string, number>();
	for (const text of chunks) {
		messages = applySingleUpdate(
			messages,
			{ type: "user_message_chunk", sessionId: "s", text } as never,
			index,
		);
	}
	const user = messages.find((m) => m.role === "user");
	if (!user) throw new Error("no user message");
	return user;
}

function textOf(m: ChatMessage): string {
	return m.content
		.filter((b) => b.type === "text")
		.map((b) => (b as { text: string }).text)
		.join("");
}

function chipUris(m: ChatMessage): string[] {
	return m.content
		.filter((b) => b.type === "resource_link")
		.map((b) => (b as { uri: string }).uri);
}

describe("I268: Claude replay of an embedded resource", () => {
	it("pinned note on the first message shows only the user's words and one chip", () => {
		const user = replay([
			`[@Small note.md](${A})`,
			`[@Small note.md](${A})`,
			RUBRIC,
			"Reply with the code word.",
			context(A, "# Small note\n\nThe code word is PELICAN."),
		]);
		expect(textOf(user)).toBe("Reply with the code word.");
		expect(chipUris(user)).toEqual([A]);
	});

	it("an @-mention keeps the user's words and one chip", () => {
		const user = replay([
			"Summarize @Small note",
			`[@Small note.md](${A})`,
			context(A, "The code word is PELICAN."),
		]);
		expect(textOf(user)).toBe("Summarize @Small note");
		expect(chipUris(user)).toEqual([A]);
	});

	it("two notes strip both context blocks and keep both chips in order", () => {
		const user = replay([
			`[@Small note.md](${A})`,
			`[@Other note.md](${B})`,
			"Compare them.",
			context(A, "Alpha body."),
			context(B, "Beta body."),
		]);
		expect(textOf(user)).toBe("Compare them.");
		expect(chipUris(user)).toEqual([A, B]);
	});

	it("user text that contains a literal <context survives", () => {
		const open = `What does <context ref="file:///x.md"> mean here?`;
		expect(textOf(replay([open]))).toBe(open);

		// A complete trailing block with no matching chip is the user's text.
		const typed = `Explain this markup:\n<context ref="file:///y.md">\nhello\n</context>`;
		const user = replay([typed]);
		expect(textOf(user)).toBe(typed);
		expect(chipUris(user)).toEqual([]);
	});
});
