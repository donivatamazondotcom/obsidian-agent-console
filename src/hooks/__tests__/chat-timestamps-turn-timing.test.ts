/**
 * Chat Timestamps PR 1 — the hook owns turn timing.
 *
 * Seam (R2): the public `useAgentMessages` API (sendMessage, enqueueUpdate,
 * discardPendingTurn) with only the ACP port faked (R4): `sendPrompt` is a
 * promise the test answers, and session updates are fed in as the `acp/`
 * layer emits them. Real message-sender and message-state run. The clock is
 * faked (Date only) so times are exact; timers stay real. Assertions are on
 * the persisted message fields (R3).
 *
 * Spec: [[Agent Console Chat Timestamps]] § Turn timing has one owner,
 * § Gap stamps, § Tool-call times.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useAgentMessages } from "../useAgentMessages";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";
import type { IVaultAccess } from "../../services/vault-service";
import type { IMentionService } from "../../utils/mention-parser";
import type {
	ChatSession,
	SessionUpdate,
	TurnStopKind,
} from "../../types/session";
import type { ChatMessage, MessageContent } from "../../types/chat";

const T0 = Date.UTC(2026, 10, 15, 17, 0, 0);
const SEC = 1000;
const MIN = 60 * SEC;

const vaultAccess = {
	readNote: async () => "",
	getAllFiles: () => [],
	getFileByPath: () => null,
} as unknown as IVaultAccess & IMentionService;

type Prompt = {
	resolve: (r: { stopKind: TurnStopKind }) => void;
	reject: (e: unknown) => void;
};

function setup(titleStrategy = "agent-timestamp") {
	const prompts: Prompt[] = [];
	const sendPrompt = vi.fn(
		() =>
			new Promise<{ stopKind: TurnStopKind }>((resolve, reject) => {
				prompts.push({ resolve, reject });
			}),
	);
	const agentClient = { sendPrompt } as unknown as AcpClient;
	const settingsAccess = {
		getSnapshot: () => ({ titleStrategy, windowsWslMode: false }),
	} as unknown as ISettingsAccess;
	const session = {
		sessionId: "s1",
		authMethods: [],
		promptCapabilities: { embeddedContext: true, image: false, audio: false },
	} as unknown as ChatSession;
	const hook = renderHook(() =>
		useAgentMessages(agentClient, settingsAccess, vaultAccess, session, vi.fn()),
	);
	return { ...hook, prompts };
}

type Result = { current: ReturnType<typeof useAgentMessages> };

async function flushBatch() {
	await act(async () => {
		await new Promise((res) => requestAnimationFrame(() => res(null)));
		await new Promise((res) => setTimeout(res, 0));
	});
}

async function send(result: Result, isFirstMessage = false) {
	act(() => {
		void result.current.sendMessage("go", {
			vaultBasePath: "/vault",
			contextNotes: [],
			isFirstMessage,
		});
	});
	await flushBatch();
}

async function feed(result: Result, ...updates: SessionUpdate[]) {
	act(() => {
		for (const u of updates) result.current.enqueueUpdate(u);
	});
	await flushBatch();
}

async function answer(prompts: Prompt[], stopKind: TurnStopKind = "endTurn") {
	await act(async () => {
		prompts[prompts.length - 1].resolve({ stopKind });
		await Promise.resolve();
	});
	await flushBatch();
}

function at(ms: number) {
	vi.setSystemTime(ms);
}

const chunk = (text: string): SessionUpdate => ({
	type: "agent_message_chunk",
	sessionId: "s1",
	text,
});

const tool = (id: string, fields: Record<string, unknown>): SessionUpdate =>
	({ type: "tool_call_update", sessionId: "s1", toolCallId: id, ...fields }) as SessionUpdate;

const options = [{ optionId: "ok", name: "Allow", kind: "allow_once" as const }];

/** What PermissionManager.request emits. */
const ask = (id: string, requestId: string, isActive: boolean): SessionUpdate =>
	({
		type: "tool_call",
		sessionId: "s1",
		toolCallId: id,
		status: "pending",
		requestedAt: Date.now(),
		permissionRequest: { requestId, options, isActive },
	}) as SessionUpdate;

/** What PermissionManager.respond emits. */
const approve = (id: string, requestId: string): SessionUpdate =>
	({
		type: "tool_call_update",
		sessionId: "s1",
		toolCallId: id,
		answeredAt: Date.now(),
		permissionRequest: { requestId, options, selectedOptionId: "ok", isActive: false },
	}) as SessionUpdate;

/** What PermissionManager.activateNext emits for the next queued request. */
const activate = (id: string, requestId: string): SessionUpdate =>
	({
		type: "tool_call_update",
		sessionId: "s1",
		toolCallId: id,
		permissionRequest: { requestId, options, isActive: true },
	}) as SessionUpdate;

function thePrompt(messages: ChatMessage[]): ChatMessage {
	const p = messages.filter((m) => m.role === "user").pop();
	if (!p) throw new Error("no prompt");
	return p;
}

type ToolItem = Extract<MessageContent, { type: "tool_call" }>;

function call(messages: ChatMessage[], id: string): ToolItem {
	const t = messages
		.flatMap((m) => m.content)
		.find((c): c is ToolItem => c.type === "tool_call" && c.toolCallId === id);
	if (!t) throw new Error(`no tool call ${id}`);
	return t;
}

function textItems(messages: ChatMessage[]) {
	return messages
		.filter((m) => m.role === "assistant")
		.flatMap((m) => m.content)
		.filter((c) => c.type === "text");
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	at(T0);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("prompt and turn-end times", () => {
	it("a prompt carries its send time", async () => {
		const { result } = setup();
		await send(result);
		expect(thePrompt(result.current.messages).sentAt).toBe(T0);
	});

	it("a finished turn records done, its end and its duration", async () => {
		const { result, prompts } = setup();
		await send(result);
		await feed(result, chunk("hi"));
		at(T0 + 5 * MIN);
		await answer(prompts);
		expect(thePrompt(result.current.messages)).toMatchObject({
			turnEndKind: "done",
			turnEndedAt: T0 + 5 * MIN,
			turnWaitMs: 0,
			turnMs: 5 * MIN,
		});
	});

	it("an answer with stop reason cancelled counts as stopped", async () => {
		const { result, prompts } = setup();
		await send(result);
		at(T0 + 1 * MIN);
		await answer(prompts, "cancelled");
		expect(thePrompt(result.current.messages).turnEndKind).toBe("stopped");
	});

	it("a failed send records failed", async () => {
		const { result, prompts } = setup();
		await send(result);
		at(T0 + 1 * MIN);
		await act(async () => {
			prompts[0].reject(new Error("boom"));
			await Promise.resolve();
		});
		await flushBatch();
		expect(thePrompt(result.current.messages)).toMatchObject({
			turnEndKind: "failed",
			turnEndedAt: T0 + 1 * MIN,
		});
	});

	it("Stop records stopped and closes the running tool call", async () => {
		const { result } = setup();
		await send(result);
		at(T0 + 10 * SEC);
		await feed(result, tool("tc1", { status: "in_progress" }));
		at(T0 + 2 * MIN);
		act(() => result.current.discardPendingTurn(10));
		await flushBatch();
		const m = result.current.messages;
		expect(thePrompt(m)).toMatchObject({ turnEndKind: "stopped", turnMs: 2 * MIN });
		expect(call(m, "tc1")).toMatchObject({ interrupted: true, endedAt: T0 + 2 * MIN });
	});

	it("a Stop that lands just after the success write keeps done", async () => {
		const { result, prompts } = setup();
		await send(result);
		at(T0 + 1 * MIN);
		await answer(prompts);
		at(T0 + 1 * MIN + 5);
		act(() => result.current.discardPendingTurn(10));
		await flushBatch();
		expect(thePrompt(result.current.messages)).toMatchObject({
			turnEndKind: "done",
			turnEndedAt: T0 + 1 * MIN,
		});
	});

	it("a steer: the stopped prompt's late answer doesn't end the new turn", async () => {
		const { result, prompts } = setup();
		await send(result);
		at(T0 + 1 * MIN);
		// The stopped prompt never answers within the settle timeout (I107),
		// so the redirect goes out first and its answer arrives during it.
		act(() => result.current.discardPendingTurn(20));
		act(() => {
			void result.current.sendMessage("redirect", {
				vaultBasePath: "/vault",
				contextNotes: [],
				isFirstMessage: false,
			});
		});
		await act(async () => {
			await new Promise((res) => setTimeout(res, 40));
		});
		await flushBatch();
		at(T0 + 2 * MIN);
		await feed(result, tool("tc2", { status: "in_progress" }));
		await act(async () => {
			prompts[0].resolve({ stopKind: "cancelled" });
			await Promise.resolve();
		});
		await flushBatch();
		const users = result.current.messages.filter((m) => m.role === "user");
		expect(users).toHaveLength(2);
		expect(users[0].turnEndKind).toBe("stopped");
		expect(users[1].turnEndedAt).toBeUndefined();
		expect(call(result.current.messages, "tc2").interrupted).toBeUndefined();
	});

	it("I356 through the hook: a completed row stays completed after a status-less update", async () => {
		const { result } = setup();
		await send(result);
		await feed(result, tool("tc1", { status: "in_progress" }));
		await feed(result, tool("tc1", { status: "completed" }));
		await feed(result, tool("tc1", { content: [{ type: "terminal", terminalId: "t1" }] }));
		expect(call(result.current.messages, "tc1").status).toBe("completed");
	});

	it("a final completed that arrives with the answer, window hidden, is not interrupted", async () => {
		const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
		try {
			const { result, prompts } = setup();
			await send(result);
			at(T0 + 5 * SEC);
			await feed(result, tool("tc1", { status: "in_progress" }));
			at(T0 + 40 * SEC);
			await act(async () => {
				result.current.enqueueUpdate(tool("tc1", { status: "completed" }));
				prompts[0].resolve({ stopKind: "endTurn" });
				await Promise.resolve();
			});
			await flushBatch();
			const t = call(result.current.messages, "tc1");
			expect(t.status).toBe("completed");
			expect(t.interrupted).toBeUndefined();
			expect(t.endedAt).toBe(T0 + 40 * SEC);
		} finally {
			vis.mockRestore();
		}
	});
});

describe("gap stamps are measured from the turn's last live update", () => {
	it("a slow first reply is measured from the send, even while the title buffer holds it", async () => {
		const { result } = setup("agent-suggested");
		await send(result, true);
		at(T0 + 2 * MIN);
		await feed(result, chunk("<title>Fo"));
		at(T0 + 2 * MIN + 1 * SEC);
		await feed(result, chunk("o</title>Hello"));
		const [item] = textItems(result.current.messages);
		expect(item).toMatchObject({ text: "Hello", gapBefore: true });
	});

	it("a quick first reply is not marked", async () => {
		const { result } = setup();
		await send(result);
		at(T0 + 20 * SEC);
		await feed(result, chunk("Hello"));
		expect(textItems(result.current.messages)[0].gapBefore).toBe(false);
	});

	it("a usage update during a silence doesn't reset the clock", async () => {
		const { result } = setup();
		await send(result);
		at(T0 + 30 * SEC);
		await feed(result, { type: "usage_update", sessionId: "s1", size: 10, used: 1 });
		at(T0 + 70 * SEC);
		await feed(result, chunk("Hello"));
		expect(textItems(result.current.messages)[0].gapBefore).toBe(true);
	});

	it("content that arrives after a finished turn gets no gap stamp", async () => {
		const { result, prompts } = setup();
		await send(result);
		at(T0 + 10 * SEC);
		await feed(result, chunk("done"));
		at(T0 + 1 * MIN);
		await answer(prompts);
		at(T0 + 5 * MIN);
		await feed(result, tool("late", { status: "completed" }));
		expect(call(result.current.messages, "late").gapBefore).toBe(false);
	});

	it("a never-closed title marker released at turn end keeps the time it arrived", async () => {
		const { result, prompts } = setup("agent-suggested");
		await send(result, true);
		at(T0 + 10 * SEC);
		await feed(result, chunk("<titl"));
		at(T0 + 3 * MIN);
		await feed(result, tool("tc1", { status: "completed" }));
		at(T0 + 4 * MIN);
		await answer(prompts);
		const [item] = textItems(result.current.messages);
		expect(item).toMatchObject({ arrivedAt: T0 + 10 * SEC, gapBefore: false });
	});

	it("a replayed update during a silence doesn't reset the clock", async () => {
		const { result } = setup();
		await send(result);
		at(T0 + 30 * SEC);
		await feed(result, { ...chunk("old"), replayed: true } as SessionUpdate);
		at(T0 + 70 * SEC);
		await feed(result, tool("tc1", { status: "in_progress" }));
		expect(call(result.current.messages, "tc1").gapBefore).toBe(true);
	});

	it("two items in one flush after a long silence: only the first is marked", async () => {
		const { result } = setup();
		await send(result);
		at(T0 + 2 * MIN);
		await feed(result, tool("tc1", { status: "in_progress" }), chunk("then text"));
		expect(call(result.current.messages, "tc1").gapBefore).toBe(true);
		expect(textItems(result.current.messages)[0].gapBefore).toBe(false);
	});
});

describe("time waiting on you is left out", () => {
	it("a 10-minute permission is left out of the turn and counted on the call", async () => {
		const { result, prompts } = setup();
		await send(result);
		at(T0 + 1 * MIN);
		await feed(result, ask("tc1", "r1", true));
		at(T0 + 11 * MIN);
		await feed(result, approve("tc1", "r1"));
		at(T0 + 12 * MIN);
		await feed(result, tool("tc1", { status: "completed" }));
		await answer(prompts);
		expect(thePrompt(result.current.messages)).toMatchObject({
			turnWaitMs: 10 * MIN,
			turnMs: 2 * MIN,
		});
		expect(call(result.current.messages, "tc1").waitMs).toBe(10 * MIN);
	});

	it("two requests pending together count their 10 minutes once", async () => {
		const { result, prompts } = setup();
		await send(result);
		at(T0 + 1 * MIN);
		await feed(result, ask("a", "r1", true), ask("b", "r2", false));
		at(T0 + 6 * MIN);
		// Answering the first activates the second in the same batch.
		await feed(result, approve("a", "r1"), activate("b", "r2"));
		at(T0 + 11 * MIN);
		await feed(result, approve("b", "r2"));
		at(T0 + 12 * MIN);
		await answer(prompts);
		const p = thePrompt(result.current.messages);
		expect(p.turnWaitMs).toBe(10 * MIN);
		expect(p.turnMs).toBe(2 * MIN);
	});

	it("Stop during a 10-minute permission leaves the wait out of the turn and the row", async () => {
		const { result } = setup();
		await send(result);
		at(T0 + 1 * MIN);
		await feed(result, ask("tc1", "r1", true));
		at(T0 + 11 * MIN);
		act(() => result.current.discardPendingTurn(10));
		await flushBatch();
		const m = result.current.messages;
		expect(thePrompt(m)).toMatchObject({
			turnEndKind: "stopped",
			turnWaitMs: 10 * MIN,
			turnMs: 1 * MIN,
		});
		expect(call(m, "tc1")).toMatchObject({
			interrupted: true,
			endedAt: T0 + 11 * MIN,
			waitMs: 10 * MIN,
		});
	});

	it("the agent dying during a wait closes the call as not finished", async () => {
		const { result, prompts } = setup();
		await send(result);
		at(T0 + 1 * MIN);
		await feed(result, ask("tc1", "r1", true));
		at(T0 + 11 * MIN);
		// cancelAll's `completed` reaches the queue just before the prompt's
		// rejection, in the same task.
		await act(async () => {
			result.current.enqueueUpdate(
				tool("tc1", {
					status: "completed",
					permissionRequest: {
						requestId: "r1",
						options,
						isCancelled: true,
						isActive: false,
					},
				}),
			);
			prompts[0].reject(new Error("process exited"));
			await Promise.resolve();
		});
		await flushBatch();
		const m = result.current.messages;
		expect(thePrompt(m)).toMatchObject({ turnEndKind: "failed", turnWaitMs: 10 * MIN });
		expect(call(m, "tc1")).toMatchObject({ interrupted: true, waitMs: 10 * MIN });
	});

	it("answer the first of two, then Stop: the second row leaves its own wait out", async () => {
		const { result } = setup();
		await send(result);
		at(T0 + 1 * MIN);
		await feed(result, ask("a", "r1", true), ask("b", "r2", false));
		at(T0 + 3 * MIN);
		await feed(result, approve("a", "r1"), activate("b", "r2"));
		at(T0 + 9 * MIN);
		act(() => result.current.discardPendingTurn(10));
		await flushBatch();
		const b = call(result.current.messages, "b");
		expect(b).toMatchObject({ interrupted: true, endedAt: T0 + 9 * MIN, waitMs: 8 * MIN });
		expect(call(result.current.messages, "a").waitMs).toBe(2 * MIN);
	});
});
