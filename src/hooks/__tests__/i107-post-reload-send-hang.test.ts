/**
 * T-I107 — reproduce-first test for the post-hard-reload silent send loss.
 *
 * Bug: after a user interrupt (hard reload / Stop / New chat) cancels a
 * streaming turn, that turn's `sendPromise` never settles — the in-flight
 * `sendPreparedPrompt` (the agent's `session/prompt` RPC) is neither resolved
 * nor rejected when the subprocess is disconnected (observed with Claude Code).
 * So `sendPromiseRef.current` stays non-null forever, and the NEXT send blocks
 * at `if (sendPromiseRef.current) { await sendPromiseRef.current; }` — never
 * reaching `addMessage`. The message is silently lost.
 *
 * Fix: `discardPendingTurn()` (run on every user interrupt via
 * `useAgent.cancelOperation`) clears `sendPromiseRef.current`, so a subsequent
 * send no longer awaits the dead promise. The I106 generation bump already
 * neutralizes the orphaned turn's late result, so skipping the wait is safe.
 *
 * Verified RED (second send hangs → message never added) → GREEN after the
 * ref-clear. Spec: [[I107 Messages sent after hard reload not delivered]].
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

// First sendPreparedPrompt never settles (simulates the disconnected, cancelled
// turn whose RPC hangs). Subsequent calls resolve normally.
const { state } = vi.hoisted(() => ({ state: { calls: 0 } }));

vi.mock("../../services/message-sender", () => ({
	DEFAULT_MAX_SELECTION_LENGTH: 2000,
	preparePrompt: vi.fn(async () => ({
		agentContent: [{ type: "text", text: "x" }],
		displayContent: [{ type: "text", text: "x" }],
		autoMentionContext: null,
	})),
	sendPreparedPrompt: vi.fn(() => {
		state.calls += 1;
		if (state.calls === 1) return new Promise(() => {}); // never settles
		return Promise.resolve({ success: true });
	}),
}));

function makeDeps() {
	const agentClient = {} as unknown as AcpClient;
	const settingsAccess = {
		getSnapshot: () => ({ titleStrategy: "agent-timestamp", windowsWslMode: false }),
	} as unknown as ISettingsAccess;
	const vaultAccess = {} as unknown as IVaultAccess & IMentionService;
	const session = {
		sessionId: "s1",
		authMethods: [],
		promptCapabilities: { embeddedContext: false, image: false, audio: false },
	} as unknown as ChatSession;
	const setErrorInfo = vi.fn<(e: ErrorInfo | null) => void>();
	return { agentClient, settingsAccess, vaultAccess, session, setErrorInfo };
}

const flush = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("useAgentMessages — I107 post-interrupt send no longer hangs on a dead prior promise", () => {
	it("delivers the next message after an interrupt even when the prior send's promise never settled", async () => {
		state.calls = 0;
		const deps = makeDeps();
		const { result } = renderHook(() =>
			useAgentMessages(deps.agentClient, deps.settingsAccess, deps.vaultAccess, deps.session, deps.setErrorInfo),
		);

		// First send: reaches addMessage, then its sendPromise hangs forever
		// (sendPreparedPrompt never settles) — leaving sendPromiseRef.current set.
		act(() => {
			void result.current.sendMessage("msg1", { vaultBasePath: "" });
		});
		await act(flush);
		expect(result.current.messages.some((m) => JSON.stringify(m.content).includes("msg1"))).toBe(true);

		// User interrupts (hard reload / Stop / New chat all route here).
		act(() => {
			result.current.discardPendingTurn();
		});

		// Second send must NOT hang on the dead prior promise — it must reach addMessage.
		act(() => {
			void result.current.sendMessage("msg2", { vaultBasePath: "" });
		});
		await act(flush);

		expect(result.current.messages.some((m) => JSON.stringify(m.content).includes("msg2"))).toBe(true);
	});
});
