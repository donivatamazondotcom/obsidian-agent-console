/**
 * I316: a failed turn you have seen used to read "Ready" in the tab, the rail
 * flyout and the dropdown while its error banner was still up (11/09, Kiro V3
 * model throttle).
 *
 * Seam: the real `useAgentMessages` send path with only the ACP port faked
 * (R2, R4). `errorInfo` lives in a `useState`, exactly as `useAgent` holds it
 * (`useAgent.ts:159`), and is fed through `hasFailedTurnBanner` +
 * `deriveTabState` as ChatPanel wires them. Outcome: the tab state the user
 * sees (R3). The tab is live and being viewed (`unseen: null`), which is the
 * reported case.
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useAgentMessages } from "../useAgentMessages";
import { deriveTabState, hasFailedTurnBanner } from "../../resolvers/tab-state";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";
import type { IVaultAccess } from "../../services/vault-service";
import type { IMentionService } from "../../utils/mention-parser";
import type { ChatSession } from "../../types/session";
import type { ErrorInfo } from "../../types/errors";

const vaultAccess = {
	readNote: async () => "",
	getAllFiles: () => [],
	getFileByPath: () => null,
} as unknown as IVaultAccess & IMentionService;

// The 11/09 wire payload (I317 changes its title; this test doesn't read it).
const THROTTLE = {
	code: -32000,
	message:
		"claude-opus-5.5 is experiencing high traffic. Try again, or select another model.",
	data: { errorType: "ModelThrottleError", retryErrorType: "THROTTLING" },
};

function setup(sendPrompt: AcpClient["sendPrompt"]) {
	const agentClient = { sendPrompt } as unknown as AcpClient;
	const settingsAccess = {
		getSnapshot: () => ({ titleStrategy: "agent-timestamp", windowsWslMode: false }),
	} as unknown as ISettingsAccess;
	const session = {
		sessionId: "s1",
		authMethods: [],
		promptCapabilities: { embeddedContext: true, image: false, audio: false },
	} as unknown as ChatSession;
	return renderHook(() => {
		const [errorInfo, setErrorInfo] = React.useState<ErrorInfo | null>(null);
		const messages = useAgentMessages(
			agentClient,
			settingsAccess,
			vaultAccess,
			session,
			setErrorInfo,
		);
		const tabState = deriveTabState({
			lifecycle: "ready",
			isSending: messages.isSending,
			hasActivePermission: false,
			unseen: null,
			hasHeldSession: false,
			hasFailedTurnBanner: hasFailedTurnBanner(messages.lastTurnEnd, errorInfo),
		});
		return { messages, errorInfo, setErrorInfo, tabState };
	});
}

type Harness = ReturnType<typeof setup>["result"];

async function send(result: Harness) {
	await act(async () => {
		await result.current.messages.sendMessage("hi", {
			vaultBasePath: "/vault",
			contextNotes: [],
			isFirstMessage: false,
		});
	});
}

function failing() {
	return vi.fn<AcpClient["sendPrompt"]>().mockRejectedValue(THROTTLE);
}

describe("I316: a seen failed turn shows failed while its banner is up", () => {
	it("a failed send reads failed, not ready (the reported symptom)", async () => {
		const { result } = setup(failing());
		await send(result);
		expect(result.current.errorInfo).not.toBeNull();
		expect(result.current.errorInfo).toBe(result.current.messages.lastTurnEnd?.errorInfo);
		expect(result.current.tabState).toBe("failed");
	});

	it("dismissing the banner returns the tab to ready", async () => {
		const { result } = setup(failing());
		await send(result);
		act(() => result.current.messages.clearError());
		expect(result.current.tabState).toBe("ready");
	});

	it("clearing the chat returns the tab to ready", async () => {
		const { result } = setup(failing());
		await send(result);
		act(() => result.current.messages.clearMessages());
		expect(result.current.tabState).toBe("ready");
	});

	it("a resend that succeeds returns the tab to ready", async () => {
		const sendPrompt = vi
			.fn<AcpClient["sendPrompt"]>()
			.mockRejectedValueOnce(THROTTLE)
			.mockResolvedValueOnce({ stopKind: "endTurn" });
		const { result } = setup(sendPrompt);
		await send(result);
		expect(result.current.tabState).toBe("failed");
		// handleSendMessage dismisses the banner before sending; this harness
		// sends directly, so the old banner stays but no longer counts.
		await send(result);
		expect(result.current.messages.lastTurnEnd?.outcome).toBe("endTurn");
		expect(result.current.tabState).toBe("ready");
	});

	it("a different error replacing the banner is not this turn's failure", async () => {
		const { result } = setup(failing());
		await send(result);
		act(() =>
			result.current.setErrorInfo({ title: "Session Creation Failed", message: "x" }),
		);
		expect(result.current.tabState).toBe("ready");
	});

	it("a failed resend is failed again with the new banner", async () => {
		const { result } = setup(failing());
		await send(result);
		const first = result.current.errorInfo;
		await send(result);
		expect(result.current.errorInfo).not.toBe(first);
		expect(result.current.tabState).toBe("failed");
	});
});
