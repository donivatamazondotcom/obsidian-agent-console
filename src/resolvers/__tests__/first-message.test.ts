/**
 * I265 — `decideFirstMessage` truth table, plus the two gates it feeds.
 *
 * "First message of the chat" (title rubric, first-message history save,
 * auto-default note) and "first message of this agent session" (the system
 * instruction) are different questions: after a fallback the chat continues
 * but the agent session is new.
 */
import { describe, expect, it } from "vitest";

import {
	decideFirstMessage,
	isFirstMessageOfChat,
	sendsSystemInstruction,
	type FirstMessageKind,
} from "../first-message";

describe("decideFirstMessage", () => {
	it.each<[number, boolean, boolean, FirstMessageKind]>([
		// transcript, continuesExistingSession, freshSessionAfterFallback → kind
		[0, false, false, "new-chat"],
		[0, false, true, "new-chat"],
		[0, true, false, "continuing"], // I241: restored agent-only tab
		[0, true, true, "new-agent-session"],
		[3, false, false, "continuing"],
		[3, false, true, "new-agent-session"], // live tab, soft reload fresh
		[3, true, false, "continuing"], // real load with local history
		[3, true, true, "new-agent-session"], // restored tab, then reload fresh
	])(
		"transcript %i, continues %s, fresh after fallback %s → %s",
		(transcriptLength, continuesExistingSession, freshSessionAfterFallback, kind) => {
			expect(
				decideFirstMessage({
					transcriptLength,
					continuesExistingSession,
					freshSessionAfterFallback,
				}),
			).toBe(kind);
		},
	);
});

describe("first-message gates", () => {
	it.each<[FirstMessageKind, boolean, boolean]>([
		["new-chat", true, true],
		["new-agent-session", true, false],
		["continuing", false, false],
	])("%s → instruction %s, chat-first extras %s", (kind, instruction, chatFirst) => {
		expect(sendsSystemInstruction(kind)).toBe(instruction);
		expect(isFirstMessageOfChat(kind)).toBe(chatFirst);
	});
});
