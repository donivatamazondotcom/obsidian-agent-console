/**
 * I280 — a retry that recovers through load clears "Session Creation Failed".
 *
 * Since I280 a retry after a double failure reloads the restored session. A
 * typing retry or the I72 recover click succeeds through
 * `updateSessionFromLoad`, which never cleared the error the failed
 * `createSession` set, so the tab sat `ready` under the error banner.
 * `createSession` clears it first, before any await; `updateSessionFromLoad`
 * now does the same.
 *
 * Seams (R2, R4): the real `useAgent` hook and a real `AcpClient`; only its
 * spawn (`doInitialize`) and the wire are stubbed. Assertion on the shared
 * `errorInfo` the error banner renders from (R3), checked while the load's
 * config restore is still awaiting the agent.
 *
 * Spec: [[I280 A retry after a failed fallback session loses the fallback]].
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useAgent } from "../useAgent";
import { AcpClient } from "../../acp/acp-client";
import type AgentClientPlugin from "../../plugin";
import type { ISettingsAccess } from "../../services/settings-service";
import type { IVaultAccess } from "../../services/vault-service";
import type { IMentionService } from "../../utils/mention-parser";
import type { SessionConfigOption } from "../../types/session";

const AGENT = "test-agent";
const CWD = "/vault";

function settings() {
	const snapshot: Record<string, unknown> = {
		defaultAgentId: AGENT,
		claude: { id: "claude", displayName: "Claude" },
		codex: { id: "codex", displayName: "Codex" },
		gemini: { id: "gemini", displayName: "Gemini" },
		kiro: { id: "kiro", displayName: "Kiro" },
		opencode: { id: "opencode-acp", displayName: "OpenCode" },
		antigravity: { id: "antigravity-acp", displayName: "Antigravity CLI", command: "agy", args: ["acp"], env: [], apiKeySecretId: "" },
		customAgents: [
			{ id: AGENT, displayName: "Test Agent", command: "claude-agent-acp", args: [], env: [] },
		],
		// A saved model that differs from the session's, so the load's config
		// restore has to ask the agent (an await the test holds open).
		lastUsedModels: { [AGENT]: "m2" },
		lastUsedModes: {},
		lastUsedThoughtLevels: {},
	};
	return {
		getSnapshot: () => snapshot,
		updateSettings: vi.fn(async () => {}),
	} as unknown as ISettingsAccess;
}

const MODEL_OPTION = {
	id: "model",
	name: "Model",
	category: "model",
	type: "select",
	currentValue: "m1",
	options: [
		{ value: "m1", name: "M1" },
		{ value: "m2", name: "M2" },
	],
} as unknown as SessionConfigOption;

describe("I280 — a retry that recovers through load clears the error", () => {
	it("updateSessionFromLoad clears 'Session Creation Failed' before awaiting the agent", async () => {
		const plugin = {
			settings: { autoAllowPermissions: false, windowsWslMode: false },
			manifest: { version: "0.0.0-test" },
		} as unknown as AgentClientPlugin;
		const client = new AcpClient(plugin);
		const internals = client as unknown as {
			currentConfig: unknown;
			currentAgentId: string | null;
			isInitializedFlag: boolean;
			doInitialize: (config: { command: string }) => Promise<unknown>;
		};
		// The agent can't start: createSession fails and sets the error.
		vi.spyOn(internals, "doInitialize").mockRejectedValue(
			new Error("Agent exited before initialize"),
		);
		let releaseConfig!: () => void;
		vi.spyOn(client, "setSessionConfigOption").mockImplementation(
			() =>
				new Promise((resolve) => {
					releaseConfig = () => resolve([MODEL_OPTION]);
				}),
		);

		const hook = renderHook(() =>
			useAgent(client, settings(), {} as IVaultAccess & IMentionService, CWD, AGENT),
		);
		await act(async () => {
			await hook.result.current.createSession();
		});
		expect(hook.result.current.errorInfo?.title).toBeTruthy();

		// The retry recovered the restored session through load.
		let done!: Promise<void>;
		await act(async () => {
			done = hook.result.current.updateSessionFromLoad(
				"sess-x",
				undefined,
				undefined,
				[MODEL_OPTION],
			);
			await new Promise((r) => setTimeout(r, 0));
		});
		expect(client.setSessionConfigOption).toHaveBeenCalled();
		expect(hook.result.current.errorInfo).toBeNull();

		await act(async () => {
			releaseConfig();
			await done;
		});
		expect(hook.result.current.errorInfo).toBeNull();
		expect(hook.result.current.session.sessionId).toBe("sess-x");
	});
});
