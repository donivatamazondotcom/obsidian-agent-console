/**
 * T-I106 — reproduce-first test for the reload/stop "Internal error" leak.
 *
 * Bug: when a user interrupts an in-flight turn (header ↻ reload, Stop button,
 * or New chat) while the agent is streaming, the subprocess is cancelled +
 * disconnected. Kiro CLI answers the aborted `session/prompt` with a -32603
 * "Internal error" result. `useAgentMessages.sendMessage`'s in-flight handler
 * then calls `setErrorInfo(...)`, leaving a spurious red error overlay — even
 * though the user themselves interrupted the turn.
 *
 * Fix: `discardPendingTurn()` bumps the generation so the late result/error is
 * a no-op (the handler early-returns on a generation mismatch). This test
 * asserts the error overlay is NEVER set with the aborted prompt's error.
 *
 * Verified RED against the unfixed handler (no generation bump → overlay set),
 * GREEN after the bump. Spec: [[I106 Reload or Stop during streaming surfaces
 * aborted prompt Internal error]].
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

// Control the prompt RPC's resolution timing so we can interrupt mid-flight.
const { deferred } = vi.hoisted(() => ({
	deferred: { resolve: null as null | ((v: unknown) => void) },
}));

vi.mock("../../services/message-sender", () => ({
	DEFAULT_MAX_SELECTION_LENGTH: 2000,
	preparePrompt: vi.fn(async () => ({
		agentContent: [{ type: "text", text: "hi" }],
		displayContent: [{ type: "text", text: "hi" }],
		autoMentionContext: null,
	})),
	// Returns a promise we resolve manually to simulate the aborted prompt
	// coming back AFTER the user interrupts.
	sendPreparedPrompt: vi.fn(
		() => new Promise((res) => {
			deferred.resolve = res as (v: unknown) => void;
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
		promptCapabilities: { embeddedContext: false, image: false, audio: false },
	} as unknown as ChatSession;
	const setErrorInfo = vi.fn<(e: ErrorInfo | null) => void>();
	return { agentClient, settingsAccess, vaultAccess, session, setErrorInfo };
}

const INTERNAL_ERROR_RESULT = {
	success: false,
	error: {
		title: "Internal Error",
		message: "Internal error",
		suggestion: "Try again or restart the agent session.",
	},
};

describe("useAgentMessages — I106 reload/stop discards the aborted turn's error", () => {
	it("does NOT surface the error overlay when the turn was discarded mid-flight", async () => {
		const { agentClient, settingsAccess, vaultAccess, session, setErrorInfo } =
			makeDeps();

		const { result } = renderHook(() =>
			useAgentMessages(agentClient, settingsAccess, vaultAccess, session, setErrorInfo),
		);

		let sendDone!: Promise<void>;
		act(() => {
			sendDone = result.current.sendMessage("hi", { vaultBasePath: "" });
		});

		// Let sendMessage reach the in-flight `await sendPreparedPrompt(...)`.
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(deferred.resolve).not.toBeNull();
		expect(result.current.isSending).toBe(true);

		// User interrupts (reload / stop / new chat all route through this).
		act(() => {
			result.current.discardPendingTurn();
		});

		// The aborted prompt now returns Kiro's -32603 "Internal error".
		await act(async () => {
			deferred.resolve?.(INTERNAL_ERROR_RESULT);
			await sendDone;
		});

		// The fix: the discarded turn's error must never reach the overlay.
		const errorOverlayCalls = setErrorInfo.mock.calls.filter(
			([arg]) => arg !== null && (arg as ErrorInfo).title === "Internal Error",
		);
		expect(errorOverlayCalls).toHaveLength(0);
		// Streaming state is reset by the interrupt.
		expect(result.current.isSending).toBe(false);
	});

	it("control: without an interrupt, a real prompt error DOES surface (guard is not over-broad)", async () => {
		const { agentClient, settingsAccess, vaultAccess, session, setErrorInfo } =
			makeDeps();

		const { result } = renderHook(() =>
			useAgentMessages(agentClient, settingsAccess, vaultAccess, session, setErrorInfo),
		);

		let sendDone!: Promise<void>;
		act(() => {
			sendDone = result.current.sendMessage("hi", { vaultBasePath: "" });
		});
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		// No discard this time — a genuine prompt failure must still show.
		await act(async () => {
			deferred.resolve?.(INTERNAL_ERROR_RESULT);
			await sendDone;
		});

		const errorOverlayCalls = setErrorInfo.mock.calls.filter(
			([arg]) => arg !== null && (arg as ErrorInfo).title === "Internal Error",
		);
		expect(errorOverlayCalls).toHaveLength(1);
	});
});
