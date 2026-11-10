/**
 * I302: the session records why its Kiro process runs V2 (`kiroEngineFallback`)
 * at every place it copies the launched engine. The init result is the truth
 * for its process, so a later V3 init's undefined replaces "old-cli" – never
 * `init?.x ?? prev.x`, which would keep the update tip on a V3 tab (design
 * review H2).
 *
 * Seams (R2, R4): a real AcpClient and the real useAgent hook; only
 * `doInitialize` (the spawn) and the wire are stubbed, as in the I247 test.
 * Assertions are on session state (R3) with literal expectations (R5).
 *
 * Red-first (R1): on main the session has no `kiroEngineFallback`.
 */

import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAgent } from "../useAgent";
import { AcpClient } from "../../acp/acp-client";
import { AcpTypeConverter } from "../../acp/type-converter";
import { InitializeSupersededError } from "../../utils/error-utils";
import type AgentClientPlugin from "../../plugin";
import type { ISettingsAccess } from "../../services/settings-service";
import type { IVaultAccess } from "../../services/vault-service";
import type { IMentionService } from "../../utils/mention-parser";
import type * as acp from "@agentclientprotocol/sdk";

const AGENT = "test-agent";
const CWD = "/vault";

const RAW_INIT = {
	protocolVersion: 1,
	agentCapabilities: { loadSession: true },
} as unknown as acp.InitializeResponse;

function makeSettings() {
	const agent = {
		id: AGENT,
		displayName: "Test Kiro",
		command: "kiro-cli",
		args: ["acp"],
		env: [],
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

/** The kiro-cli on this machine: "old" falls back to V2, "current" runs V3. */
function makeClient() {
	const cli = { version: "old" as "old" | "current" | "broken" };
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
		requireConnection: () => unknown;
	};
	vi.spyOn(internals, "doInitialize").mockImplementation(async (config) => {
		if (cli.version === "broken") throw new Error("spawn failed");
		const launch =
			cli.version === "old"
				? { ...config, kiroEngine: "v2" as const, kiroEngineFallback: "old-cli" as const }
				: { ...config, kiroEngine: "v3" as const };
		internals.currentConfig = launch;
		internals.currentAgentId = AGENT;
		internals.isInitializedFlag = true;
		return AcpTypeConverter.toInitializeResult(RAW_INIT, launch);
	});
	const request = vi.fn(async (method: string) =>
		method === "session/new" ? { sessionId: "s1" } : {},
	);
	vi.spyOn(internals, "requireConnection").mockReturnValue({ agent: { request } });
	return { client, cli };
}

const vault = {} as IVaultAccess & IMentionService;
const launch = {
	id: AGENT,
	displayName: "Test Kiro",
	command: "kiro-cli",
	args: ["acp"],
	env: [],
	workingDirectory: CWD,
} as unknown as Parameters<AcpClient["initialize"]>[0];

describe("I302: kiroEngineFallback travels with the session", () => {
	it("createSession on an old CLI records the fallback; a V3 relaunch clears it", async () => {
		const { client, cli } = makeClient();
		const hook = renderHook(() => useAgent(client, makeSettings(), vault, CWD, AGENT));
		await act(async () => {
			await hook.result.current.createSession();
		});
		expect(hook.result.current.session.kiroEngine).toBe("v2");
		expect(hook.result.current.session.kiroEngineFallback).toBe("old-cli");

		// The user runs `kiro-cli update`; the next launch gets V3.
		cli.version = "current";
		await act(async () => {
			await hook.result.current.createSession();
		});
		expect(hook.result.current.session.kiroEngine).toBe("v3");
		expect(hook.result.current.session.kiroEngineFallback).toBeUndefined();
	});

	it("lazy fresh tab: applyInitCapabilities records the fallback (tip before the first send)", async () => {
		const { client } = makeClient();
		await client.initialize(launch);
		const hook = renderHook(() => useAgent(client, makeSettings(), vault, CWD, AGENT));
		act(() => hook.result.current.applyInitCapabilities());
		expect(hook.result.current.session.kiroEngineFallback).toBe("old-cli");
	});

	it("restored tab: load records the fallback from the cached init result", async () => {
		const { client } = makeClient();
		await client.initialize(launch);
		const hook = renderHook(() => useAgent(client, makeSettings(), vault, CWD, AGENT));
		await act(async () => {
			await hook.result.current.updateSessionFromLoad("s1", undefined, undefined, undefined);
		});
		expect(hook.result.current.session.kiroEngineFallback).toBe("old-cli");
	});

	it("a failed start clears it, so the tip doesn't sit above the error", async () => {
		const { client, cli } = makeClient();
		const hook = renderHook(() => useAgent(client, makeSettings(), vault, CWD, AGENT));
		await act(async () => {
			await hook.result.current.createSession();
		});
		expect(hook.result.current.session.kiroEngineFallback).toBe("old-cli");
		cli.version = "broken";
		await act(async () => {
			await hook.result.current.createSession();
		});
		expect(hook.result.current.session.state).toBe("error");
		expect(hook.result.current.session.kiroEngineFallback).toBeUndefined();
	});

	it("a failed restore initialize clears it (applyInitFailure, review M1)", async () => {
		const { client } = makeClient();
		const hook = renderHook(() => useAgent(client, makeSettings(), vault, CWD, AGENT));
		await act(async () => {
			await hook.result.current.createSession();
		});
		expect(hook.result.current.session.kiroEngineFallback).toBe("old-cli");
		act(() => {
			hook.result.current.applyInitFailure(new Error("spawn failed"));
		});
		expect(hook.result.current.session.kiroEngineFallback).toBeUndefined();
	});

	it("a superseded start leaves the newer start's fallback alone (review L4)", async () => {
		const { client } = makeClient();
		const hook = renderHook(() => useAgent(client, makeSettings(), vault, CWD, AGENT));
		await act(async () => {
			await hook.result.current.createSession();
		});
		act(() => {
			hook.result.current.applyInitFailure(new InitializeSupersededError());
		});
		expect(hook.result.current.session.kiroEngineFallback).toBe("old-cli");
	});

	it("agent switch clears it", async () => {
		const { client } = makeClient();
		const hook = renderHook(() => useAgent(client, makeSettings(), vault, CWD, AGENT));
		await act(async () => {
			await hook.result.current.createSession();
		});
		act(() => hook.result.current.setAgentWithoutSession("claude"));
		expect(hook.result.current.session.kiroEngineFallback).toBeUndefined();
	});
});
