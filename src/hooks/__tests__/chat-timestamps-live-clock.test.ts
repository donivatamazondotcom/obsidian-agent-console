/**
 * Chat Timestamps PR 3: the live turn's clocks, read synchronously by the
 * ticker through `getLiveTurnClock()` (spec § Ticker and store).
 *
 * Seam (R2): the public `useAgentMessages` API with only the ACP port faked;
 * updates are fed as the `acp/` layer emits them. The clock is faked (Date
 * only). Assertions are on the returned clock (R3), which is the ticker's only
 * input from the hook.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useAgentMessages } from "../useAgentMessages";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";
import type { IVaultAccess } from "../../services/vault-service";
import type { IMentionService } from "../../utils/mention-parser";
import type { ChatSession, SessionUpdate, TurnStopKind } from "../../types/session";
import type { ChatMessage } from "../../types/chat";

const T0 = Date.UTC(2026, 10, 15, 17, 0, 0);
const SEC = 1000;

const vaultAccess = {
	readNote: async () => "",
	getAllFiles: () => [],
	getFileByPath: () => null,
} as unknown as IVaultAccess & IMentionService;

type Prompt = { resolve: (r: { stopKind: TurnStopKind }) => void };

function setup() {
	const prompts: Prompt[] = [];
	const sendPrompt = vi.fn(
		() => new Promise<{ stopKind: TurnStopKind }>((resolve) => prompts.push({ resolve })),
	);
	const agentClient = { sendPrompt } as unknown as AcpClient;
	const settingsAccess = {
		getSnapshot: () => ({ titleStrategy: "agent-timestamp", windowsWslMode: false }),
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

async function send(result: Result) {
	act(() => {
		void result.current.sendMessage("go", { vaultBasePath: "/vault", contextNotes: [], isFirstMessage: false });
	});
	await flushBatch();
}

async function feed(result: Result, ...updates: SessionUpdate[]) {
	act(() => {
		for (const u of updates) result.current.enqueueUpdate(u);
	});
	await flushBatch();
}

async function answer(prompts: Prompt[]) {
	await act(async () => {
		prompts[prompts.length - 1].resolve({ stopKind: "endTurn" });
		await Promise.resolve();
	});
	await flushBatch();
}

const at = (ms: number) => vi.setSystemTime(ms);
const chunk = (text: string): SessionUpdate => ({ type: "agent_message_chunk", sessionId: "s1", text });
const tool = (id: string, fields: Record<string, unknown>): SessionUpdate =>
	({ type: "tool_call_update", sessionId: "s1", toolCallId: id, ...fields }) as SessionUpdate;
const options = [{ optionId: "ok", name: "Allow", kind: "allow_once" as const }];
const ask = (id: string): SessionUpdate =>
	({
		type: "tool_call",
		sessionId: "s1",
		toolCallId: id,
		status: "pending",
		requestedAt: Date.now(),
		permissionRequest: { requestId: "r1", options, isActive: true },
	}) as SessionUpdate;
const approve = (id: string): SessionUpdate =>
	({
		type: "tool_call_update",
		sessionId: "s1",
		toolCallId: id,
		answeredAt: Date.now(),
		permissionRequest: { requestId: "r1", options, selectedOptionId: "ok", isActive: false },
	}) as SessionUpdate;

function promptId(messages: ChatMessage[]): string {
	const p = messages.filter((m) => m.role === "user").pop();
	if (!p) throw new Error("no prompt");
	return p.id;
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	at(T0);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("getLiveTurnClock", () => {
	it("is null with no turn running", () => {
		const { result } = setup();
		expect(result.current.getLiveTurnClock()).toBeNull();
	});

	it("starts at the send, with no update yet", async () => {
		const { result } = setup();
		await send(result);
		const clock = result.current.getLiveTurnClock();
		expect(clock).toMatchObject({
			promptId: promptId(result.current.messages),
			sentAt: T0,
			lastUpdateAt: T0,
			hasUpdate: false,
			waitStartedAt: null,
			turnWaitMs: 0,
		});
		expect(clock?.lastOutputAtByCall.size).toBe(0);
	});

	it("an allowlisted update moves the last update; a usage update doesn't", async () => {
		const { result } = setup();
		await send(result);
		at(T0 + 20 * SEC);
		await feed(result, { type: "usage_update", sessionId: "s1", size: 10, used: 1 } as SessionUpdate);
		expect(result.current.getLiveTurnClock()).toMatchObject({ lastUpdateAt: T0, hasUpdate: false });
		at(T0 + 30 * SEC);
		await feed(result, chunk("Hello"));
		expect(result.current.getLiveTurnClock()).toMatchObject({ lastUpdateAt: T0 + 30 * SEC, hasUpdate: true });
	});

	it("records a call's last output only from updates flagged as output", async () => {
		const { result } = setup();
		await send(result);
		at(T0 + 5 * SEC);
		await feed(result, tool("tc1", { status: "in_progress", title: "npm test" }));
		await feed(result, tool("tc2", { status: "in_progress", title: "sleep 30" }));
		at(T0 + 7 * SEC);
		await feed(result, tool("tc1", { carriesOutput: true }));
		at(T0 + 8 * SEC);
		await feed(result, tool("tc2", { title: "sleep 30 && echo done" }));
		const map = result.current.getLiveTurnClock()?.lastOutputAtByCall;
		expect(map?.get("tc1")).toBe(T0 + 7 * SEC);
		expect(map?.has("tc2")).toBe(false);
	});

	it("ignores a replayed output update", async () => {
		const { result } = setup();
		await send(result);
		await feed(result, tool("tc1", { status: "in_progress" }));
		await feed(result, { ...tool("tc1", { carriesOutput: true }), replayed: true } as SessionUpdate);
		expect(result.current.getLiveTurnClock()?.lastOutputAtByCall.has("tc1")).toBe(false);
	});

	it("tracks the permission wait", async () => {
		const { result } = setup();
		await send(result);
		at(T0 + 10 * SEC);
		await feed(result, ask("tc1"));
		expect(result.current.getLiveTurnClock()?.waitStartedAt).toBe(T0 + 10 * SEC);
		at(T0 + 40 * SEC);
		await feed(result, approve("tc1"));
		expect(result.current.getLiveTurnClock()).toMatchObject({ waitStartedAt: null, turnWaitMs: 30 * SEC });
	});

	it("is null once the turn ends, and the next turn starts with an empty output map", async () => {
		const { result, prompts } = setup();
		await send(result);
		await feed(result, tool("tc1", { status: "in_progress" }), tool("tc1", { carriesOutput: true }));
		await answer(prompts);
		expect(result.current.getLiveTurnClock()).toBeNull();
		at(T0 + 60 * SEC);
		await send(result);
		expect(result.current.getLiveTurnClock()?.lastOutputAtByCall.size).toBe(0);
	});

	it("is null after a Stop or a clear", async () => {
		const { result } = setup();
		await send(result);
		act(() => result.current.discardPendingTurn(10));
		expect(result.current.getLiveTurnClock()).toBeNull();

		await send(result);
		act(() => result.current.clearMessages());
		expect(result.current.getLiveTurnClock()).toBeNull();
	});

	// The live turn itself belongs to its send (it ends at the send's answer);
	// a restore only empties the per-turn facts, and isSending going false
	// stops the ticker.
	it("a restore during a turn empties its output map and update flag", async () => {
		const { result } = setup();
		await send(result);
		await feed(result, tool("tc1", { status: "in_progress" }), tool("tc1", { carriesOutput: true }));
		expect(result.current.getLiveTurnClock()?.lastOutputAtByCall.size).toBe(1);
		act(() => result.current.setMessagesFromLocal([]));
		const clock = result.current.getLiveTurnClock();
		expect(clock?.lastOutputAtByCall.size).toBe(0);
		expect(clock?.hasUpdate).toBe(false);
		expect(result.current.isSending).toBe(false);
	});
});
