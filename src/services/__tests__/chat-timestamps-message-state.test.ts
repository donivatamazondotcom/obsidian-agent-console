/**
 * Chat Timestamps PR 1 — time data in message state (no UI).
 *
 * Seam (R2): `applySingleUpdate` over the SessionUpdate events the hook
 * applies, and `applyTurnEnd`, the pure turn-end writer the hook calls at
 * every turn end. No mocks (R4). Assertions are on the resulting message
 * state, which is what the session file persists (R3).
 *
 * Spec: [[Agent Console Chat Timestamps]] § Time fields, § Replay is marked,
 * § Turn timing has one owner, § Tool-call times. I356 covers the
 * missing-status fix.
 */
import { describe, expect, it } from "vitest";

import {
	applySingleUpdate,
	applyTurnEnd,
	createStreamContinuity,
} from "../message-state";
import type { ChatMessage, MessageContent } from "../../types/chat";
import type { SessionUpdate } from "../../types/session";

const S = "s1";
const T0 = Date.UTC(2026, 10, 15, 17, 0, 0);
const SEC = 1000;
const MIN = 60 * SEC;

type Step = { u: SessionUpdate; now: number; before: number | null };

function run(steps: Step[], start: ChatMessage[] = []): ChatMessage[] {
	const index = new Map<string, number>();
	const continuity = createStreamContinuity();
	let messages = start;
	for (const s of steps) {
		messages = applySingleUpdate(messages, s.u, index, continuity, {
			now: s.now,
			lastUpdateBefore: s.before,
		});
	}
	return messages;
}

const text = (t: string, extra: Partial<SessionUpdate> = {}): SessionUpdate =>
	({ type: "agent_message_chunk", sessionId: S, text: t, ...extra }) as SessionUpdate;

const tool = (
	type: "tool_call" | "tool_call_update",
	fields: Record<string, unknown> = {},
): SessionUpdate =>
	({ type, sessionId: S, toolCallId: "tc1", ...fields }) as SessionUpdate;

type ToolItem = Extract<MessageContent, { type: "tool_call" }>;

function items(messages: ChatMessage[]): MessageContent[] {
	return messages.flatMap((m) => m.content);
}

function theTool(messages: ChatMessage[]): ToolItem {
	const t = items(messages).find((c) => c.type === "tool_call");
	if (!t || t.type !== "tool_call") throw new Error("no tool call");
	return t;
}

function prompt(id: string, sentAt: number | null): ChatMessage {
	return {
		id,
		role: "user",
		content: [{ type: "text", text: "go" }],
		timestamp: new Date(sentAt ?? T0),
		sentAt,
	};
}

describe("content items carry their arrival time", () => {
	it("a new text item gets arrivedAt, and later chunks keep it", () => {
		const m = run([
			{ u: text("Hel"), now: T0 + 5 * SEC, before: T0 },
			{ u: text("lo"), now: T0 + 9 * SEC, before: T0 + 5 * SEC },
		]);
		const [item] = items(m);
		expect(item).toMatchObject({ type: "text", text: "Hello" });
		expect(item.arrivedAt).toBe(T0 + 5 * SEC);
	});

	it("a plan update keeps the first plan's arrival time", () => {
		const plan = (content: string): SessionUpdate => ({
			type: "plan",
			sessionId: S,
			entries: [{ content, status: "pending", priority: "high" }],
		});
		const m = run([
			{ u: plan("a"), now: T0 + 3 * SEC, before: T0 },
			{ u: plan("b"), now: T0 + 40 * SEC, before: T0 + 3 * SEC },
		]);
		const planItem = items(m).find((c) => c.type === "plan");
		expect(planItem).toMatchObject({
			entries: [{ content: "b" }],
			arrivedAt: T0 + 3 * SEC,
		});
	});
});

describe("gap stamps are decided once, at arrival", () => {
	it("an item more than 60 seconds after the last live update is marked", () => {
		const m = run([{ u: text("late"), now: T0 + 61 * SEC, before: T0 }]);
		expect(items(m)[0].gapBefore).toBe(true);
	});

	it("an item 30 seconds after the last live update is not", () => {
		const m = run([{ u: text("soon"), now: T0 + 30 * SEC, before: T0 }]);
		expect(items(m)[0].gapBefore).toBe(false);
	});

	it("a pause inside one text block is not marked", () => {
		const m = run([
			{ u: text("a"), now: T0 + 1 * SEC, before: T0 },
			{ u: text("b"), now: T0 + 5 * MIN, before: T0 + 1 * SEC },
		]);
		expect(items(m)).toHaveLength(1);
		expect(items(m)[0].gapBefore).toBe(false);
	});

	it("a tool call that arrives after a long silence is marked", () => {
		const m = run([
			{ u: tool("tool_call", { status: "in_progress" }), now: T0 + 3 * MIN, before: T0 },
		]);
		expect(theTool(m).gapBefore).toBe(true);
	});

	it("no previous live update means no gap stamp", () => {
		const m = run([{ u: text("x"), now: T0 + 10 * MIN, before: null }]);
		expect(items(m)[0].gapBefore).toBe(false);
	});
});

describe("replayed history has no times (no stamp beats a wrong stamp)", () => {
	it("replayed text, tool calls and user text get null times", () => {
		const m = run([
			{
				u: { type: "user_message_chunk", sessionId: S, text: "hi", replayed: true },
				now: T0,
				before: null,
			},
			{ u: text("reply", { replayed: true }), now: T0, before: null },
			{
				u: tool("tool_call", { status: "completed", replayed: true }),
				now: T0,
				before: null,
			},
		]);
		expect(m[0]).toMatchObject({ role: "user", sentAt: null });
		const reply = items(m).find((c) => c.type === "text" && c.text === "reply");
		expect(reply?.arrivedAt).toBeNull();
		const t = theTool(m);
		expect(t.startedAt).toBeNull();
		expect(t.endedAt).toBeNull();
		expect(t.arrivedAt).toBeNull();
	});
});

describe("tool-call start and end times", () => {
	it("startedAt is set on first sight and endedAt once, on the first completed", () => {
		const m = run([
			{ u: tool("tool_call", { status: "in_progress" }), now: T0 + 1 * SEC, before: T0 },
			{ u: tool("tool_call_update", { status: "completed" }), now: T0 + 20 * SEC, before: T0 + 1 * SEC },
			{ u: tool("tool_call_update", { status: "failed" }), now: T0 + 50 * SEC, before: T0 + 20 * SEC },
		]);
		const t = theTool(m);
		expect(t.startedAt).toBe(T0 + 1 * SEC);
		expect(t.endedAt).toBe(T0 + 20 * SEC);
	});

	it("requestedAt and answeredAt survive merges, and give the call its wait", () => {
		const options = [{ optionId: "a", name: "Allow", kind: "allow_once" as const }];
		const m = run([
			{
				u: tool("tool_call", {
					status: "pending",
					requestedAt: T0 + 2 * SEC,
					permissionRequest: { requestId: "r1", options, isActive: true },
				}),
				now: T0 + 2 * SEC,
				before: T0,
			},
			{
				u: tool("tool_call_update", {
					answeredAt: T0 + 2 * SEC + 10 * MIN,
					permissionRequest: {
						requestId: "r1",
						options,
						selectedOptionId: "a",
						isActive: false,
					},
				}),
				now: T0 + 2 * SEC + 10 * MIN,
				before: T0 + 2 * SEC,
			},
			{
				u: tool("tool_call_update", { status: "in_progress" }),
				now: T0 + 11 * MIN,
				before: T0 + 2 * SEC + 10 * MIN,
			},
		]);
		const t = theTool(m);
		expect(t.requestedAt).toBe(T0 + 2 * SEC);
		expect(t.answeredAt).toBe(T0 + 2 * SEC + 10 * MIN);
		expect(t.waitMs).toBe(10 * MIN);
	});
});

describe("a status-less update after the end keeps the end time (I356)", () => {
	it("completed, then a status-less update: same endedAt", () => {
		const m = run([
			{ u: tool("tool_call", { status: "in_progress" }), now: T0 + 1 * SEC, before: T0 },
			{ u: tool("tool_call_update", { status: "completed" }), now: T0 + 5 * SEC, before: T0 + 1 * SEC },
			{
				u: tool("tool_call_update", {
					content: [{ type: "terminal", terminalId: "t1" }],
				}),
				now: T0 + 9 * SEC,
				before: T0 + 5 * SEC,
			},
		]);
		expect(theTool(m)).toMatchObject({ status: "completed", endedAt: T0 + 5 * SEC });
	});
});

describe("applyTurnEnd writes the turn and closes its open tool calls", () => {
	const before: ChatMessage = prompt("p0", T0 - 10 * MIN);

	function turn(): ChatMessage[] {
		return run(
			[
				{ u: tool("tool_call", { status: "in_progress" }), now: T0 + 1 * MIN, before: T0 },
				{
					u: { ...tool("tool_call", { status: "completed" }), toolCallId: "done" } as SessionUpdate,
					now: T0 + 2 * MIN,
					before: T0 + 1 * MIN,
				},
			],
			[before, prompt("p1", T0)],
		);
	}

	it("a done turn records its end, kind, wait and duration on the prompt", () => {
		const m = applyTurnEnd(turn(), {
			promptId: "p1",
			now: T0 + 6 * MIN,
			kind: "done",
			waitMs: 1 * MIN,
		});
		const p = m.find((x) => x.id === "p1");
		expect(p).toMatchObject({
			turnEndedAt: T0 + 6 * MIN,
			turnEndKind: "done",
			turnWaitMs: 1 * MIN,
			turnMs: 5 * MIN,
		});
		// The earlier prompt is untouched.
		expect(m[0].turnEndedAt).toBeUndefined();
	});

	it("turnMs is never below 0", () => {
		const m = applyTurnEnd(turn(), {
			promptId: "p1",
			now: T0 + 1 * MIN,
			kind: "done",
			waitMs: 5 * MIN,
		});
		expect(m.find((x) => x.id === "p1")?.turnMs).toBe(0);
	});

	it("a prompt with no known send time gets no duration", () => {
		const start = [prompt("p1", null)];
		const m = applyTurnEnd(start, { promptId: "p1", now: T0, kind: "failed", waitMs: 0 });
		expect(m[0]).toMatchObject({ turnEndKind: "failed", turnMs: null });
	});

	it("an open call is closed as interrupted, and a finished one is left alone", () => {
		const m = applyTurnEnd(turn(), {
			promptId: "p1",
			now: T0 + 6 * MIN,
			kind: "stopped",
			waitMs: 0,
		});
		const calls = items(m).filter((c): c is ToolItem => c.type === "tool_call");
		const open = calls.find((c) => c.toolCallId === "tc1");
		const done = calls.find((c) => c.toolCallId === "done");
		expect(open).toMatchObject({ interrupted: true, endedAt: T0 + 6 * MIN });
		expect(done?.interrupted).toBeUndefined();
		expect(done?.endedAt).toBe(T0 + 2 * MIN);
	});

	it("a late completed keeps the interrupted call's endedAt", () => {
		const closed = applyTurnEnd(turn(), {
			promptId: "p1",
			now: T0 + 6 * MIN,
			kind: "stopped",
			waitMs: 0,
		});
		const index = new Map<string, number>();
		const m = applySingleUpdate(closed, tool("tool_call_update", { status: "completed" }), index, undefined, {
			now: T0 + 7 * MIN,
			lastUpdateBefore: null,
		});
		const t = items(m).find((c): c is ToolItem => c.type === "tool_call" && c.toolCallId === "tc1");
		expect(t).toMatchObject({ status: "completed", interrupted: true, endedAt: T0 + 6 * MIN });
	});

	it("a call blocked on a permission closes with its wait counted to the end", () => {
		const start = run(
			[
				{
					u: tool("tool_call", {
						status: "pending",
						requestedAt: T0 + 1 * MIN,
						permissionRequest: { requestId: "r1", options: [], isActive: true },
					}),
					now: T0 + 1 * MIN,
					before: T0,
				},
			],
			[prompt("p1", T0)],
		);
		const m = applyTurnEnd(start, { promptId: "p1", now: T0 + 11 * MIN, kind: "stopped", waitMs: 10 * MIN });
		expect(theTool(m)).toMatchObject({
			interrupted: true,
			endedAt: T0 + 11 * MIN,
			waitMs: 10 * MIN,
		});
	});

	it("a call whose permission was cancelled is closed even though cancelAll marked it completed", () => {
		// The agent died during the wait: cancelAll's `completed` was applied
		// (by the flush before the close) with no answer.
		const start = run(
			[
				{
					u: tool("tool_call", {
						status: "pending",
						requestedAt: T0 + 1 * MIN,
						permissionRequest: { requestId: "r1", options: [], isActive: true },
					}),
					now: T0 + 1 * MIN,
					before: T0,
				},
				{
					u: tool("tool_call_update", {
						status: "completed",
						permissionRequest: {
							requestId: "r1",
							options: [],
							isCancelled: true,
							isActive: false,
						},
					}),
					now: T0 + 11 * MIN,
					before: T0 + 1 * MIN,
				},
			],
			[prompt("p1", T0)],
		);
		const m = applyTurnEnd(start, { promptId: "p1", now: T0 + 11 * MIN + 5, kind: "failed", waitMs: 10 * MIN });
		expect(theTool(m)).toMatchObject({
			interrupted: true,
			endedAt: T0 + 11 * MIN,
			waitMs: 10 * MIN,
		});
	});

	it("does nothing for a prompt that isn't there", () => {
		const start = turn();
		expect(applyTurnEnd(start, { promptId: "nope", now: T0, kind: "done", waitMs: 0 })).toBe(start);
	});
});
