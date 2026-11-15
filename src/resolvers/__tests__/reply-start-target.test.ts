/**
 * Jump to Start of Latest Reply — U1 / U2.
 *
 * The resolver picks where "the start of the agent's final response" is.
 * A turn is several assistant messages (every tool call starts a new one,
 * applyUpsertToolCall), so the turn shapes below are built through the real
 * streaming reducer (applySingleUpdate), not hand-written arrays, to keep
 * the test honest about how the store actually splits a turn.
 *
 * Spec: [[Jump to Start of Latest Reply]] § Behavior 2-4, § Test cases U1-U2.
 */
import { describe, expect, it } from "vitest";

import {
	applySingleUpdate,
	createStreamContinuity,
} from "../../services/message-state";
import type { ChatMessage } from "../../types/chat";
import type { SessionUpdate } from "../../types/session";
import {
	deriveJumpButtonVisible,
	deriveReplyStartTarget,
	hasNonEmptyText,
	replyStartTargetFromParts,
	replyStartTargetKey,
	type ReplyStartTarget,
} from "../reply-start-target";

const SESSION = "s-1";

type Step =
	| { user: string }
	| { text: string }
	| { thought: string }
	| { tool: string };

/** Build a transcript the way the streaming path does. */
function build(steps: Step[]): ChatMessage[] {
	const index = new Map<string, number>();
	const continuity = createStreamContinuity();
	let messages: ChatMessage[] = [];
	let userCount = 0;
	for (const step of steps) {
		if ("user" in step) {
			userCount += 1;
			messages = [
				...messages,
				{
					id: `user-${userCount}`,
					role: "user",
					content: [{ type: "text", text: step.user }],
					timestamp: new Date(0),
				},
			];
			continue;
		}
		let update: SessionUpdate;
		if ("text" in step) {
			update = { type: "agent_message_chunk", sessionId: SESSION, text: step.text };
		} else if ("thought" in step) {
			update = { type: "agent_thought_chunk", sessionId: SESSION, text: step.thought };
		} else {
			update = {
				type: "tool_call",
				sessionId: SESSION,
				toolCallId: step.tool,
				title: step.tool,
				status: "completed",
			};
		}
		messages = applySingleUpdate(messages, update, index, continuity);
	}
	return messages;
}

const textTarget = (m: ChatMessage): ReplyStartTarget => ({ kind: "text", messageId: m.id });

describe("deriveReplyStartTarget (U1)", () => {
	it("[user, asst(text)] targets that text", () => {
		const messages = build([{ user: "q" }, { text: "Answer." }]);
		expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(deriveReplyStartTarget(messages)).toEqual(textTarget(messages[1]));
	});

	it("[user, asst(text), asst(tool), asst(tool, text)] targets the final answer, not the earlier text", () => {
		const messages = build([
			{ user: "q" },
			{ text: "Let me check." },
			{ tool: "A" },
			{ tool: "B" },
			{ text: "Here is the answer." },
		]);
		// The store's real shape: the answer joins tool B's message.
		expect(messages.map((m) => m.content.map((c) => c.type))).toEqual([
			["text"],
			["text"],
			["tool_call"],
			["tool_call", "text"],
		]);
		expect(deriveReplyStartTarget(messages)).toEqual(textTarget(messages[3]));
	});

	it("[user, asst(text), asst(tool)] walks back past the trailing tool call to the earlier text", () => {
		const messages = build([{ user: "q" }, { text: "Let me check." }, { tool: "A" }]);
		expect(deriveReplyStartTarget(messages)).toEqual(textTarget(messages[1]));
	});

	it("a turn with no text targets the row of the turn's FIRST assistant message", () => {
		const messages = build([{ user: "q" }, { tool: "A" }, { tool: "B" }]);
		expect(messages).toHaveLength(3);
		expect(deriveReplyStartTarget(messages)).toEqual({
			kind: "row",
			messageId: messages[1].id,
		});
	});

	it("a thought-only turn has no text, so it targets the first assistant row", () => {
		const messages = build([{ user: "q" }, { thought: "Thinking." }]);
		expect(deriveReplyStartTarget(messages)).toEqual({
			kind: "row",
			messageId: messages[1].id,
		});
	});

	it("[user] (prompt sent, no reply yet) has no target", () => {
		const messages = build([{ user: "q" }]);
		expect(deriveReplyStartTarget(messages)).toEqual({ kind: "none" });
	});

	it("[] has no target", () => {
		expect(deriveReplyStartTarget([])).toEqual({ kind: "none" });
	});

	it("[asst(text)] with no user message (restored transcript) targets that text", () => {
		const messages = build([{ text: "Restored reply." }]);
		expect(deriveReplyStartTarget(messages)).toEqual(textTarget(messages[0]));
	});

	it("[user, asst(tool, text), user] has no target: a new prompt starts a new turn", () => {
		const messages = build([
			{ user: "q1" },
			{ tool: "A" },
			{ text: "Old answer." },
			{ user: "q2" },
		]);
		expect(deriveReplyStartTarget(messages)).toEqual({ kind: "none" });
	});

	it("only the latest turn counts", () => {
		const messages = build([
			{ user: "q1" },
			{ text: "Old answer." },
			{ user: "q2" },
			{ tool: "A" },
		]);
		expect(deriveReplyStartTarget(messages)).toEqual({
			kind: "row",
			messageId: messages[3].id,
		});
	});

	it("skips whitespace-only text", () => {
		const messages = build([
			{ user: "q" },
			{ text: "Real text." },
			{ tool: "A" },
			{ text: "  \n\t " },
		]);
		expect(messages[2].content.map((c) => c.type)).toEqual(["tool_call", "text"]);
		expect(deriveReplyStartTarget(messages)).toEqual(textTarget(messages[1]));
	});
});

describe("hasNonEmptyText", () => {
	it("is true only for a text item with visible characters", () => {
		expect(hasNonEmptyText([{ type: "text", text: "a" }])).toBe(true);
		expect(hasNonEmptyText([{ type: "text", text: " \n " }])).toBe(false);
		expect(hasNonEmptyText([{ type: "agent_thought", text: "thinking" }])).toBe(false);
		expect(hasNonEmptyText([])).toBe(false);
	});
});

describe("replyStartTargetFromParts", () => {
	it("rebuilds a target from the anchor's two primitive props", () => {
		expect(replyStartTargetFromParts("text", "m1")).toEqual({ kind: "text", messageId: "m1" });
		expect(replyStartTargetFromParts("row", "m2")).toEqual({ kind: "row", messageId: "m2" });
		expect(replyStartTargetFromParts("none", null)).toEqual({ kind: "none" });
	});

	it("an invalid combination is none", () => {
		expect(replyStartTargetFromParts("text", null)).toEqual({ kind: "none" });
		expect(replyStartTargetFromParts("row", null)).toEqual({ kind: "none" });
		expect(replyStartTargetFromParts("none", "m1")).toEqual({ kind: "none" });
	});
});

describe("deriveJumpButtonVisible (U2)", () => {
	const target: ReplyStartTarget = { kind: "text", messageId: "m3" };
	const key = replyStartTargetKey(target);
	const base = {
		isSending: false,
		isAcquiring: false,
		target,
		observed: { key, above: true },
	};

	it("is true when idle, the target's top was observed above the edge", () => {
		expect(deriveJumpButtonVisible(base)).toBe(true);
	});

	it.each([
		["sending", { isSending: true }],
		["acquiring the session", { isAcquiring: true }],
		["no target", { target: { kind: "none" } as ReplyStartTarget }],
		["no observation yet", { observed: null }],
		["an observation for a different target", { observed: { key: "text:other", above: true } }],
		["the target's top is not above the edge", { observed: { key, above: false } }],
	])("is false when %s", (_name, patch) => {
		expect(deriveJumpButtonVisible({ ...base, ...patch })).toBe(false);
	});

	it("a row target shows the same way", () => {
		const row: ReplyStartTarget = { kind: "row", messageId: "m3" };
		expect(
			deriveJumpButtonVisible({
				...base,
				target: row,
				observed: { key: replyStartTargetKey(row), above: true },
			}),
		).toBe(true);
	});
});

describe("replyStartTargetKey", () => {
	it("differs across kinds and ids", () => {
		const keys = [
			replyStartTargetKey({ kind: "none" }),
			replyStartTargetKey({ kind: "text", messageId: "m1" }),
			replyStartTargetKey({ kind: "row", messageId: "m1" }),
			replyStartTargetKey({ kind: "text", messageId: "m2" }),
		];
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys[0]).toBe("none");
	});
});
