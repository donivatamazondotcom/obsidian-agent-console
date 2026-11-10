/**
 * I247: the tab knows it runs Kiro CLI, decided at the `acp/` edge.
 *
 * Before I250, `session.kiroEngine` was "v2" for every launch that wasn't
 * V3, Claude included (I235), so it couldn't tell a Kiro V2 tab from a
 * Claude tab. Since I250 the engine is set only when `kiroCli` is. The
 * header's Engine and Mode lines need that distinction. It is normalized once
 * in `AcpTypeConverter.toInitializeResult` from the LAUNCH config (a V3
 * launch, or a kiro-cli command), never from the agent id, and copied into
 * session state next to `kiroEngine`.
 *
 * Seams (R2, R4): the real converter, a real AcpClient and the real useAgent
 * hook; only `doInitialize` (the spawn) and the wire are stubbed, the same
 * seam as the I235 test. Assertions are on `InitializeResult` and session
 * state (R3); the expected values are literals, not a re-run of the
 * normalization (R5).
 *
 * Red-first (R1): on main `toInitializeResult` has no `kiroCli` field and
 * the session never carries one, so every assertion below fails.
 *
 * Spec: [[I247 Header tooltip uses internal terms and omits the V2 engine]].
 */

import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAgent } from "../useAgent";
import { AcpClient } from "../../acp/acp-client";
import { AcpTypeConverter } from "../../acp/type-converter";
import { deriveHeaderEngine } from "../../resolvers/header-agent";
import type AgentClientPlugin from "../../plugin";
import type { ISettingsAccess } from "../../services/settings-service";
import type { IVaultAccess } from "../../services/vault-service";
import type { IMentionService } from "../../utils/mention-parser";
import type * as acp from "@agentclientprotocol/sdk";

const AGENT = "test-agent";
const CWD = "/vault";

const RAW_INIT = {
	protocolVersion: 1,
	agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
} as unknown as acp.InitializeResponse;

/** claude-agent-acp's real initialize reply (probed 2026-11-02). */
const CLAUDE_INIT = {
	...RAW_INIT,
	agentInfo: { name: "@agentclientprotocol/claude-agent-acp", title: "Claude Agent", version: "0.57.0" },
} as unknown as acp.InitializeResponse;

function makeSettings(command: string, engine: "v2" | "v3" = "v2") {
	const agent: Record<string, unknown> = {
		id: AGENT,
		displayName: "Test Agent",
		command,
		args: ["acp"],
		env: [],
		engine,
	};
	const settings: Record<string, unknown> = {
		defaultAgentId: AGENT,
		claude: { id: "claude", displayName: "Claude" },
		codex: { id: "codex", displayName: "Codex" },
		gemini: { id: "gemini", displayName: "Gemini" },
		kiro: { id: "kiro", displayName: "Kiro" },
		opencode: { id: "opencode-acp", displayName: "OpenCode" },
		antigravity: { id: "antigravity-acp", displayName: "Antigravity CLI", command: "agy", args: ["acp"], env: [], apiKeySecretId: "" },
		customAgents: [agent],
		lastUsedModels: {},
		lastUsedModes: {},
		lastUsedThoughtLevels: {},
	};
	return {
		getSnapshot: () => settings,
		updateSettings: vi.fn(async () => {}),
	} as unknown as ISettingsAccess;
}

function makeClient(rawInit: acp.InitializeResponse = RAW_INIT) {
	const plugin = {
		settings: { autoAllowPermissions: false, windowsWslMode: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	const client = new AcpClient(plugin);
	const internals = client as unknown as {
		currentConfig: unknown;
		currentAgentId: string | null;
		isInitializedFlag: boolean;
		doInitialize: (config: { kiroEngine?: "v3"; command: string }) => Promise<unknown>;
		requireConnection: () => unknown;
	};
	vi.spyOn(internals, "doInitialize").mockImplementation(async (config) => {
		internals.currentConfig = config;
		internals.currentAgentId = AGENT;
		internals.isInitializedFlag = true;
		return AcpTypeConverter.toInitializeResult(rawInit, config);
	});
	const request = vi.fn(async (method: string) =>
		method === "session/new" ? { sessionId: "s1" } : {},
	);
	vi.spyOn(internals, "requireConnection").mockReturnValue({ agent: { request } });
	return client;
}

const vault = {} as IVaultAccess & IMentionService;

function launchConfig(command: string, kiroEngine?: "v3") {
	return {
		id: AGENT, displayName: "Test Agent", command, args: ["acp"],
		env: [], workingDirectory: CWD, ...(kiroEngine ? { kiroEngine } : {}),
	} as unknown as Parameters<AcpClient["initialize"]>[0];
}

describe("I247: acp edge records whether the tab runs Kiro CLI", () => {
	it("kiro-cli and kiro-cli-chat commands, any path, are Kiro", () => {
		for (const command of [
			"kiro-cli",
			"/Users/me/.toolbox/bin/kiro-cli",
			"kiro-cli-chat",
			"C:\\tools\\kiro-cli.exe",
		]) {
			expect(AcpTypeConverter.toInitializeResult(RAW_INIT, { command }).kiroCli).toBe(true);
		}
	});

	it("a V3 launch is Kiro whatever the command is", () => {
		expect(
			AcpTypeConverter.toInitializeResult(RAW_INIT, {
				command: "/opt/wrappers/my-kiro",
				kiroEngine: "v3",
			}).kiroCli,
		).toBe(true);
	});

	it("Claude is not Kiro and has no engine (I250)", () => {
		const init = AcpTypeConverter.toInitializeResult(RAW_INIT, {
			command: "claude-agent-acp",
		});
		expect(init.kiroEngine).toBeUndefined();
		expect(init.kiroCli).toBe(false);
	});
});

describe("I247: kiroCli travels with the session", () => {
	it("fresh session on a Kiro V2 agent carries kiroCli: true", async () => {
		const hook = renderHook(() =>
			useAgent(makeClient(), makeSettings("kiro-cli"), vault, CWD, AGENT),
		);
		await act(async () => {
			await hook.result.current.createSession();
		});
		expect(hook.result.current.session.kiroEngine).toBe("v2");
		expect(hook.result.current.session.kiroCli).toBe(true);
	});

	it("fresh session on a Claude agent carries kiroCli: false", async () => {
		const hook = renderHook(() =>
			useAgent(makeClient(), makeSettings("claude-agent-acp"), vault, CWD, AGENT),
		);
		await act(async () => {
			await hook.result.current.createSession();
		});
		expect(hook.result.current.session.kiroCli).toBe(false);
	});

	it("restored tab: load carries kiroCli from the cached init result", async () => {
		const client = makeClient();
		await client.initialize(launchConfig("kiro-cli"));
		const hook = renderHook(() =>
			useAgent(client, makeSettings("kiro-cli"), vault, CWD, AGENT),
		);
		await act(async () => {
			await hook.result.current.updateSessionFromLoad("s1", undefined, undefined, undefined);
		});
		expect(hook.result.current.session.kiroCli).toBe(true);
	});

	it("lazy fresh tab: applyInitCapabilities carries kiroCli", async () => {
		const client = makeClient();
		await client.initialize(launchConfig("kiro-cli"));
		const hook = renderHook(() =>
			useAgent(client, makeSettings("kiro-cli"), vault, CWD, AGENT),
		);
		act(() => hook.result.current.applyInitCapabilities());
		expect(hook.result.current.session.kiroCli).toBe(true);
	});

	// Smoke finding (2026-11-02): a Claude tab never showed its Engine line.
	// `agentInfo` reached the session only when createSession was handed an
	// init result; the lazy paths (initialize first, session later) dropped it.
	it("lazy fresh tab: applyInitCapabilities carries the reported agentInfo", async () => {
		const client = makeClient(CLAUDE_INIT);
		await client.initialize(launchConfig("claude-agent-acp"));
		const hook = renderHook(() =>
			useAgent(client, makeSettings("claude-agent-acp"), vault, CWD, AGENT),
		);
		act(() => hook.result.current.applyInitCapabilities());
		expect(deriveHeaderEngine(hook.result.current.session)).toEqual({
			kind: "reported",
			label: "Claude Agent 0.57.0",
		});
	});

	it("session created after an earlier initialize carries agentInfo", async () => {
		const client = makeClient(CLAUDE_INIT);
		await client.initialize(launchConfig("claude-agent-acp"));
		const hook = renderHook(() =>
			useAgent(client, makeSettings("claude-agent-acp"), vault, CWD, AGENT),
		);
		await act(async () => {
			await hook.result.current.createSession();
		});
		expect(hook.result.current.session.agentInfo?.title).toBe("Claude Agent");
	});

	it("restored tab: load carries agentInfo from the cached init result", async () => {
		const client = makeClient(CLAUDE_INIT);
		await client.initialize(launchConfig("claude-agent-acp"));
		const hook = renderHook(() =>
			useAgent(client, makeSettings("claude-agent-acp"), vault, CWD, AGENT),
		);
		await act(async () => {
			await hook.result.current.updateSessionFromLoad("s1", undefined, undefined, undefined);
		});
		expect(hook.result.current.session.agentInfo?.version).toBe("0.57.0");
	});

	it("agent switch clears kiroCli", async () => {
		const hook = renderHook(() =>
			useAgent(makeClient(), makeSettings("kiro-cli"), vault, CWD, AGENT),
		);
		await act(async () => {
			await hook.result.current.createSession();
		});
		expect(hook.result.current.session.kiroCli).toBe(true);
		act(() => hook.result.current.setAgentWithoutSession("claude"));
		expect(hook.result.current.session.kiroCli).toBeUndefined();
	});
});
