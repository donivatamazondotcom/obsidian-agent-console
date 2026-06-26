import { describe, it, expect } from "vitest";
import { TitleHeadBuffer } from "../../utils/titleMarker";
import { applySingleUpdate } from "../message-state";
import type { ChatMessage } from "../../types/chat";
import type { SessionUpdate } from "../../types/session";

/**
 * T53 — marker stripped from the saved transcript.
 *
 * The saved transcript is built from `messages`, and the head buffer (S3)
 * strips the `<title>…</title>` marker from the live stream BEFORE it reaches
 * applySingleUpdate / applyUpdateLastMessage. This test drives the exact
 * pipeline useAgentMessages uses (TitleHeadBuffer.push → emit → applySingleUpdate
 * as an agent_message_chunk) and asserts the resulting assistant message text
 * is the answer only, with no marker — so a reload (which replays `messages`)
 * can never resurface it.
 */

function streamThroughBuffer(chunks: string[]): ChatMessage[] {
	const buf = new TitleHeadBuffer();
	const index = new Map<string, number>();
	let messages: ChatMessage[] = [];
	for (const chunk of chunks) {
		const r = buf.push(chunk);
		if (r.emit === null) continue; // held
		const update: SessionUpdate = {
			type: "agent_message_chunk",
			sessionId: "s1",
			text: r.emit,
		};
		messages = applySingleUpdate(messages, update, index);
	}
	return messages;
}

function assistantText(messages: ChatMessage[]): string {
	const last = messages[messages.length - 1];
	const block = last?.content.find((c) => c.type === "text");
	return block && "text" in block ? block.text : "";
}

describe("T53 — title marker stripped from the persisted assistant message", () => {
	it("whole marker + answer in one chunk → message holds only the answer", () => {
		const messages = streamThroughBuffer([
			"<title>Fix scroll jitter</title>\n\nThe answer body.",
		]);
		expect(assistantText(messages)).toBe("The answer body.");
		expect(assistantText(messages)).not.toContain("<title>");
	});

	it("marker split across chunks, answer in later chunks → no marker persisted", () => {
		const messages = streamThroughBuffer([
			"<title>Explain ",
			"merge vs rebase</title>\n\nBoth ",
			"integrate changes.",
		]);
		const text = assistantText(messages);
		expect(text).toBe("Both integrate changes.");
		expect(text).not.toContain("<title>");
		expect(text).not.toContain("</title>");
	});

	it("no marker emitted: the reply is persisted verbatim (T54 interim path)", () => {
		const messages = streamThroughBuffer([
			"Here is a plain answer ",
			"with no title marker.",
		]);
		expect(assistantText(messages)).toBe(
			"Here is a plain answer with no title marker.",
		);
	});
});
