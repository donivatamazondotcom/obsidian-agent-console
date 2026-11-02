/**
 * I228 (a2) — reproduce-first: the first message sent on a restored
 * agent-only tab shows only the user's words, AFTER the replayed history.
 *
 * Trace (2026-11-01, claude-agent-acp + kiro-cli V3, see I228 § Trace):
 *  - Neither agent echoes a NEW prompt as `user_message_chunk`. The
 *    "live echo" hypothesis is refuted.
 *  - Both replay the stored prompt on `session/load` BEFORE answering it.
 *
 * So the `hi<obsidian_system_instruction>…` bubble is an ordering race in
 * useAgentMessages: a restored agent-only tab loads lazily on first send. The
 * replay's updates are batched (rAF) and still pending when the queued send
 * flushes on the connect edge, so `addMessage("hi")` commits FIRST and the
 * replayed user chunks then append to the newest user message — "hi". The
 * replayed history is glued under the new message instead of above it, which
 * is also why "no earlier history appeared".
 *
 * Entry seam: the public hook API (enqueueUpdate + sendMessage). Only the ACP
 * port (agentClient) is faked. Replay chunks come from the real preparePrompt
 * so the wrapper under test is the one the plugin actually sends.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useAgentMessages } from "../useAgentMessages";
import { preparePrompt } from "../../services/message-sender";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";
import type { IVaultAccess } from "../../services/vault-service";
import type { IMentionService } from "../../utils/mention-parser";
import type { ChatSession } from "../../types/session";
import type { ChatMessage } from "../../types/chat";

const OLD_WORDS = "Plan the Lisbon offsite";

const vaultAccess = {
	readNote: async () => "",
	getAllFiles: () => [],
	getFileByPath: () => null,
} as unknown as IVaultAccess & IMentionService;

async function replayedFirstTurn(): Promise<string[]> {
	const prepared = await preparePrompt(
		{
			message: OLD_WORDS,
			vaultBasePath: "/vault",
			workingDirectory: "/vault",
			isFirstMessage: true,
			titleStrategy: "agent-suggested",
			supportsEmbeddedContext: true,
			contextNotes: [],
		},
		vaultAccess,
		vaultAccess,
	);
	return prepared.agentContent.flatMap((b) =>
		b.type === "text" ? [b.text] : [],
	);
}

function setup() {
	const sendPrompt = vi.fn(async () => ({ stopReason: "end_turn" }));
	const agentClient = { sendPrompt } as unknown as AcpClient;
	const settingsAccess = {
		getSnapshot: () => ({
			titleStrategy: "agent-timestamp",
			windowsWslMode: false,
		}),
	} as unknown as ISettingsAccess;
	const session = {
		sessionId: "s1",
		authMethods: [],
		promptCapabilities: { embeddedContext: true, image: false, audio: false },
	} as unknown as ChatSession;
	return renderHook(() =>
		useAgentMessages(agentClient, settingsAccess, vaultAccess, session, vi.fn()),
	);
}

async function flushBatch() {
	await act(async () => {
		await new Promise((res) => requestAnimationFrame(() => res(null)));
		await new Promise((res) => setTimeout(res, 0));
	});
}

function text(m: ChatMessage): string {
	return m.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

describe("I228 — first send on a restored agent-only tab", () => {
	it("replayed history lands above the new message, and the new bubble is only 'hi'", async () => {
		const { result } = setup();
		const chunks = await replayedFirstTurn();

		// session/load replay arrives (batched, not yet flushed)…
		act(() => {
			for (const t of chunks) {
				result.current.enqueueUpdate({
					type: "user_message_chunk",
					sessionId: "s1",
					text: t,
				});
			}
			result.current.enqueueUpdate({
				type: "agent_message_chunk",
				sessionId: "s1",
				text: "Here is a plan.",
			});
		});
		// …and the queued "hi" flushes on the connect edge before the next frame.
		await act(async () => {
			await result.current.sendMessage("hi", {
				vaultBasePath: "/vault",
				contextNotes: [],
				isFirstMessage: false,
			});
		});
		await flushBatch();

		const msgs = result.current.messages;
		expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
		expect(text(msgs[0])).toBe(OLD_WORDS);
		expect(text(msgs[1])).toBe("Here is a plan.");
		expect(text(msgs[2])).toBe("hi");
	});
});
