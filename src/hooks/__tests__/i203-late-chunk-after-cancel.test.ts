/**
 * T-I203 — reproduce-first test: a late chunk from a stopped reply must not
 * land in the steer redirect.
 *
 * ACP (Prompt Turn § Cancellation): after `session/cancel` the agent MAY keep
 * sending `session/update` content, but MUST do so before it answers the
 * original `session/prompt` with `stopReason: cancelled`. Chunks carry only a
 * sessionId — no turn id — so the ONLY reliable "old turn finished" signal is
 * that prompt response.
 *
 * Bug: the steer path settled on `session/cancel` (a notification, resolves
 * immediately) and sent the redirect before the cancelled prompt answered. A
 * trailing chunk of the old turn then appended to the newest assistant
 * message — the redirect's — e.g. " + 14 = 28PINEAPPLE".
 *
 * Fix: `discardPendingTurn` keeps the cancelled prompt's promise as a settle
 * gate. While it is outstanding, text/thought/plan chunks are dropped, and
 * `sendMessage` waits for it before starting the next turn. The gate is
 * bounded by a timeout so an agent whose cancelled prompt never answers
 * (I107) cannot block the next send.
 *
 * Spec: [[I203 Late chunk from a stopped reply lands in the steer redirect]].
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgentMessages } from "../useAgentMessages";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";
import type { IVaultAccess } from "../../services/vault-service";
import type { IMentionService } from "../../utils/mention-parser";
import type { ChatSession } from "../../types/session";
import type { ErrorInfo } from "../../types/errors";
import type { ChatMessage } from "../../types/chat";

// Each sendPreparedPrompt call gets a controllable resolver so the test can
// hold the cancelled prompt open while its late chunk arrives.
const { prompts } = vi.hoisted(() => ({
	prompts: [] as Array<(r: { success: boolean }) => void>,
}));

vi.mock("../../services/message-sender", () => ({
	DEFAULT_MAX_SELECTION_LENGTH: 2000,
	preparePrompt: vi.fn(async (input: { message: string }) => ({
		agentContent: [{ type: "text", text: input.message }],
		displayContent: [{ type: "text", text: input.message }],
		autoMentionContext: null,
	})),
	sendPreparedPrompt: vi.fn(
		() =>
			new Promise<{ success: boolean }>((resolve) => {
				prompts.push(resolve);
			}),
	),
}));

function makeDeps() {
	const agentClient = {} as unknown as AcpClient;
	const settingsAccess = {
		getSnapshot: () => ({
			titleStrategy: "agent-timestamp",
			windowsWslMode: false,
		}),
	} as unknown as ISettingsAccess;
	const vaultAccess = {} as unknown as IVaultAccess & IMentionService;
	const session = {
		sessionId: "s1",
		authMethods: [],
		promptCapabilities: {
			embeddedContext: false,
			image: false,
			audio: false,
		},
	} as unknown as ChatSession;
	const setErrorInfo = vi.fn<(e: ErrorInfo | null) => void>();
	return { agentClient, settingsAccess, vaultAccess, session, setErrorInfo };
}

async function flushBatch() {
	await act(async () => {
		await new Promise((res) => requestAnimationFrame(() => res(null)));
		await new Promise((res) => setTimeout(res, 0));
	});
}

const chunk = (text: string) => ({
	type: "agent_message_chunk" as const,
	sessionId: "s1",
	text,
});

function lastAssistantText(messages: ChatMessage[]): string {
	const last = [...messages].reverse().find((m) => m.role === "assistant");
	return (last?.content ?? [])
		.map((b) => (b.type === "text" ? b.text : ""))
		.join("");
}

describe("useAgentMessages — I203 late chunk after cancel", () => {
	function setup() {
		prompts.length = 0;
		const deps = makeDeps();
		return renderHook(() =>
			useAgentMessages(
				deps.agentClient,
				deps.settingsAccess,
				deps.vaultAccess,
				deps.session,
				deps.setErrorInfo,
			),
		);
	}

	it("a chunk the cancelled turn sends after the redirect was issued never lands in the redirect", async () => {
		const { result } = setup();

		// Turn 1 streams part of its reply.
		act(() => {
			void result.current.sendMessage("count", { vaultBasePath: "" });
		});
		await flushBatch();
		act(() => result.current.enqueueUpdate(chunk("(1 + 2 + 4 + 7")));
		await flushBatch();

		// Steer: cancel runs (discard → session/cancel resolves → clear), then
		// the redirect is sent straight away — before turn 1's prompt answers.
		act(() => {
			result.current.discardPendingTurn();
			result.current.clearPendingUpdates();
		});
		act(() => {
			void result.current.sendMessage("PINEAPPLE please", {
				vaultBasePath: "",
			});
		});
		await flushBatch();

		// The agent flushes a trailing chunk of turn 1 AFTER session/cancel,
		// BEFORE answering turn 1's session/prompt (spec-allowed).
		act(() => result.current.enqueueUpdate(chunk(" + 14 = 28")));
		await flushBatch();

		// Turn 1's prompt answers `cancelled`; then the redirect streams.
		await act(async () => {
			prompts[0]({ success: true });
			await Promise.resolve();
		});
		await flushBatch();
		act(() => result.current.enqueueUpdate(chunk("PINEAPPLE")));
		await flushBatch();

		const assistants = result.current.messages.filter(
			(m) => m.role === "assistant",
		);
		expect(lastAssistantText(result.current.messages)).toBe("PINEAPPLE");
		expect(assistants).toHaveLength(2);
		// The stopped reply keeps only what it streamed before the stop.
		expect(
			assistants[0].content
				.map((b) => (b.type === "text" ? b.text : ""))
				.join(""),
		).toBe("(1 + 2 + 4 + 7");
	});

	it("the redirect's user message waits until the cancelled prompt answers", async () => {
		const { result } = setup();
		act(() => {
			void result.current.sendMessage("count", { vaultBasePath: "" });
		});
		await flushBatch();
		act(() => result.current.discardPendingTurn());
		act(() => {
			void result.current.sendMessage("redirect", { vaultBasePath: "" });
		});
		await flushBatch();
		const userTexts = () =>
			result.current.messages
				.filter((m) => m.role === "user")
				.map((m) => JSON.stringify(m.content));
		expect(userTexts().some((s) => s.includes("redirect"))).toBe(false);

		await act(async () => {
			prompts[0]({ success: true });
			await Promise.resolve();
		});
		await flushBatch();
		expect(userTexts().some((s) => s.includes("redirect"))).toBe(true);
	});

	it("falls back to the timeout when the cancelled prompt never answers (I107)", async () => {
		const { result } = setup();
		act(() => {
			void result.current.sendMessage("count", { vaultBasePath: "" });
		});
		await flushBatch();
		act(() => result.current.discardPendingTurn(20));

		act(() => {
			void result.current.sendMessage("redirect", { vaultBasePath: "" });
		});
		await act(async () => {
			await new Promise((res) => setTimeout(res, 40));
		});
		await flushBatch();
		act(() => result.current.enqueueUpdate(chunk("OK")));
		await flushBatch();
		expect(lastAssistantText(result.current.messages)).toBe("OK");
	});

	it("still applies tool-call updates while the gate is closed", async () => {
		const { result } = setup();
		act(() => {
			void result.current.sendMessage("count", { vaultBasePath: "" });
		});
		await flushBatch();
		act(() =>
			result.current.enqueueUpdate({
				type: "tool_call",
				sessionId: "s1",
				toolCallId: "tc-1",
				title: "Read file",
				status: "in_progress",
			}),
		);
		await flushBatch();
		act(() => result.current.discardPendingTurn());
		act(() =>
			result.current.enqueueUpdate({
				type: "tool_call_update",
				sessionId: "s1",
				toolCallId: "tc-1",
				status: "completed",
			}),
		);
		await flushBatch();
		const tool = result.current.messages
			.flatMap((m) => m.content)
			.find((b) => b.type === "tool_call");
		expect(tool && tool.type === "tool_call" ? tool.status : null).toBe(
			"completed",
		);
	});
});
