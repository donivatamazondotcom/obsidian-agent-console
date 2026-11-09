/**
 * I316: a failed turn you have seen used to read "Ready" in the tab, the rail
 * flyout and the dropdown while its error banner was still up (11/09, Kiro V3
 * model throttle).
 *
 * Seam: the real `useAgentMessages` send path with only the ACP port faked
 * (R2, R4). `errorInfo` lives in a `useState`, exactly as `useAgent` holds it
 * (`useAgent.ts:156`), and is fed through `hasFailedTurnBanner` +
 * `deriveTabState` as ChatPanel wires them. Outcome: the tab state the user
 * sees (R3). The tab is live and being viewed (`unseen: null`), which is the
 * reported case.
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useAgentMessages } from "../useAgentMessages";
import { useAgent } from "../useAgent";
import { useTabUnseen } from "../useTabUnseen";
import { AcpClient } from "../../acp/acp-client";
import type AgentClientPlugin from "../../plugin";
import { deriveTabState, hasFailedTurnBanner } from "../../resolvers/tab-state";
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

/**
 * Review r1 findings 1 and 2: the same decision through the real `useAgent`
 * (the shared `errorInfo` the banner renders from) and the real
 * `useTabUnseen`, wired exactly as ChatPanel wires them (`ChatPanel.tsx`
 * `deriveTabState` call). Only the ACP wire (`sendPrompt`) and the browser
 * focus / visibility signals are controlled (R4).
 */
describe("I316 through useAgent + useTabUnseen (ChatPanel wiring)", () => {
	afterEach(() => vi.restoreAllMocks());

	const AGENT = "test-agent";
	function agentSettings() {
		const snapshot: Record<string, unknown> = {
			defaultAgentId: AGENT,
			claude: { id: "claude", displayName: "Claude" },
			codex: { id: "codex", displayName: "Codex" },
			gemini: { id: "gemini", displayName: "Gemini" },
			kiro: { id: "kiro", displayName: "Kiro" },
			opencode: { id: "opencode-acp", displayName: "OpenCode" },
			customAgents: [
				{ id: AGENT, displayName: "Test Agent", command: "fake-acp", args: [], env: [] },
			],
			lastUsedModels: {},
			lastUsedModes: {},
			lastUsedThoughtLevels: {},
			titleStrategy: "agent-timestamp",
			windowsWslMode: false,
		};
		return {
			getSnapshot: () => snapshot,
			updateSettings: vi.fn(async () => {}),
		} as unknown as ISettingsAccess;
	}

	async function mount(isActive: boolean) {
		let focused = true;
		vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
		vi.spyOn(document, "visibilityState", "get").mockImplementation(() => "visible");
		const plugin = {
			settings: { autoAllowPermissions: false, windowsWslMode: false },
			manifest: { version: "0.0.0-test" },
		} as unknown as AgentClientPlugin;
		const client = new AcpClient(plugin);
		vi.spyOn(client, "sendPrompt").mockRejectedValue(THROTTLE);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const containerRef = { current: container };
		const settings = agentSettings();
		const hook = renderHook(
			({ active }: { active: boolean }) => {
				const agent = useAgent(client, settings, vaultAccess, "/vault", AGENT);
				const unseen = useTabUnseen({
					lastTurnEnd: agent.lastTurnEnd,
					isSending: agent.isSending,
					isActive: active,
					containerRef,
				});
				const tabState = deriveTabState({
					lifecycle: "ready",
					isSending: agent.isSending,
					hasActivePermission: agent.hasActivePermission,
					unseen,
					hasHeldSession: false,
					hasFailedTurnBanner: hasFailedTurnBanner(agent.lastTurnEnd, agent.errorInfo),
				});
				return { agent, unseen, tabState };
			},
			{ initialProps: { active: isActive } },
		);
		await act(async () => {
			await hook.result.current.agent.updateSessionFromLoad("sess-x");
		});
		const sendFailing = async () => {
			await act(async () => {
				await hook.result.current.agent.sendMessage("hi", {
					vaultBasePath: "/vault",
					contextNotes: [],
					isFirstMessage: false,
				});
			});
		};
		return { hook, sendFailing, setFocused: (f: boolean) => (focused = f) };
	}

	it("a failure on the tab you're watching reads failed, then ready once dismissed", async () => {
		const { hook, sendFailing } = await mount(true);
		await sendFailing();
		expect(hook.result.current.agent.errorInfo).not.toBeNull();
		expect(hook.result.current.unseen).toBeNull();
		expect(hook.result.current.tabState).toBe("failed");
		act(() => hook.result.current.agent.clearError());
		expect(hook.result.current.tabState).toBe("ready");
	});

	it("a background failure settles on stopped early, then reads failed once viewed", async () => {
		const { hook, sendFailing } = await mount(false);
		await sendFailing();
		expect(hook.result.current.unseen).toEqual({ kind: "stopped" });
		expect(hook.result.current.tabState).toBe("stoppedUnseen");
		hook.rerender({ active: true });
		expect(hook.result.current.unseen).toBeNull();
		expect(hook.result.current.tabState).toBe("failed");
	});
});
