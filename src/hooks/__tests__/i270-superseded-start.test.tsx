/**
 * I270 (code review N2): an old-CLI start that a disconnect or an agent
 * switch replaced rejects with `InitializeSupersededError`. The tab must not
 * show "Session creation failed" or go to the error state for it, because
 * the call that replaced it owns the tab.
 *
 * Seam (R2): the real `useAgent` hook over a real `AcpClient`; only the
 * process launch (`doInitialize`) is replaced, at the `acp/` port (R4).
 * Outcome (R3): the tab's `errorInfo` and session state.
 *
 * Red-first (R1): without the `isInitializeSuperseded` check in
 * `createSession`, the tab ends in `state: "error"` with the generic
 * "Session creation failed" banner.
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAgent } from "../useAgent";
import { AcpClient } from "../../acp/acp-client";
import { InitializeSupersededError } from "../../utils/error-utils";
import type AgentClientPlugin from "../../plugin";
import type { ISettingsAccess } from "../../services/settings-service";
import type { IVaultAccess } from "../../services/vault-service";
import type { IMentionService } from "../../utils/mention-parser";

const AGENT = "test-agent";

function makeSettings() {
	const settings: Record<string, unknown> = {
		defaultAgentId: AGENT,
		claude: { id: "claude", displayName: "Claude" },
		codex: { id: "codex", displayName: "Codex" },
		gemini: { id: "gemini", displayName: "Gemini" },
		kiro: { id: "kiro", displayName: "Kiro" },
		opencode: { id: "opencode-acp", displayName: "OpenCode" },
		antigravity: { id: "antigravity-acp", displayName: "Antigravity CLI", command: "agy", args: ["acp"], env: [], apiKeySecretId: "" },
		customAgents: [
			{ id: AGENT, displayName: "Kiro (old CLI)", command: "kiro-cli", args: ["acp"], env: [], engine: "v2" },
		],
		lastUsedModels: {},
		lastUsedModes: {},
		lastUsedThoughtLevels: {},
	};
	return {
		getSnapshot: () => settings,
		updateSettings: vi.fn(async () => {}),
	} as unknown as ISettingsAccess;
}

function makeClient(reject: Error) {
	const plugin = {
		settings: { autoAllowPermissions: false, windowsWslMode: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	const client = new AcpClient(plugin);
	const internals = client as unknown as {
		doInitialize: (config: unknown, pin: boolean) => Promise<unknown>;
	};
	vi.spyOn(internals, "doInitialize").mockRejectedValue(reject);
	return client;
}

const vault = {} as IVaultAccess & IMentionService;

describe("I270 — a superseded start leaves the tab alone", () => {
	it("no error banner and no error state", async () => {
		const client = makeClient(new InitializeSupersededError());
		const hook = renderHook(() => useAgent(client, makeSettings(), vault, "/vault", AGENT));
		let result: string | null = "unset";
		await act(async () => {
			result = await hook.result.current.createSession();
		});
		expect(result).toBeNull();
		expect(hook.result.current.errorInfo).toBeNull();
		expect(hook.result.current.session.state).not.toBe("error");
	});

	it("guard: any other start failure still shows its error", async () => {
		const client = makeClient(new Error("spawn ENOENT"));
		const hook = renderHook(() => useAgent(client, makeSettings(), vault, "/vault", AGENT));
		await act(async () => {
			await hook.result.current.createSession();
		});
		expect(hook.result.current.session.state).toBe("error");
		expect(hook.result.current.errorInfo?.message).toMatch(/spawn ENOENT/);
	});
});
