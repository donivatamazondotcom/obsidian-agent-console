/**
 * I235: the header tooltip names the engine the tab's process was LAUNCHED
 * with, not the live Kiro CLI engine setting.
 *
 * Before the fix, ChatPanel built the Runtime line from
 * `resolveAgentKiroEngine(plugin.settings, session.agentId)`. Flipping the
 * setting while a tab was open changed that tab's tooltip, even though its
 * process kept running the old engine. Example: a V3 tab lost its
 * "Kiro CLI (V3 engine)" line after the setting was switched to V2.
 *
 * Fix: the launched engine is normalized once at the `acp/` edge
 * (`AcpTypeConverter.toInitializeResult`) into `InitializeResult.kiroEngine`,
 * copied into session state wherever capabilities are, and
 * `deriveHeaderRuntime` reads it from the session.
 *
 * Seams (R2, R4): a real AcpClient and the real useAgent hook; only
 * `doInitialize` (the process spawn) and the wire are stubbed. Its result is
 * built by the real converter, so the test does not restate the
 * normalization (R5). Assertions are on session state and the resolver
 * output ChatPanel renders (R3).
 *
 * Red-first (R1): on main the converter ignores the launched config, the
 * session carries no `kiroEngine`, and every assertion below fails.
 *
 * Spec: [[I235 Header tooltip reads the Kiro engine from settings, not the running tab]].
 */

import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAgent } from "../useAgent";
import { AcpClient } from "../../acp/acp-client";
import { AcpTypeConverter } from "../../acp/type-converter";
import { deriveHeaderRuntime } from "../../resolvers/header-agent";
import type AgentClientPlugin from "../../plugin";
import type { ISettingsAccess } from "../../services/settings-service";
import type { IVaultAccess } from "../../services/vault-service";
import type { IMentionService } from "../../utils/mention-parser";
import type * as acp from "@agentclientprotocol/sdk";

const AGENT = "test-agent";
const CWD = "/vault";

/** V3 kiro-cli sends no agentInfo in initialize. */
const RAW_INIT = {
	protocolVersion: 1,
	agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
} as unknown as acp.InitializeResponse;

type Engine = "v2" | "v3";

function makeSettings(engine: Engine) {
	const agent: Record<string, unknown> = {
		id: AGENT,
		displayName: "Test Agent",
		command: "kiro-cli",
		args: ["acp"],
		env: [],
		...(engine === "v3" ? { engine: "v3" } : {}),
	};
	const settings: Record<string, unknown> = {
		defaultAgentId: AGENT,
		claude: { id: "claude", displayName: "Claude" },
		codex: { id: "codex", displayName: "Codex" },
		gemini: { id: "gemini", displayName: "Gemini" },
		kiro: { id: "kiro", displayName: "Kiro" },
		opencode: { id: "opencode-acp", displayName: "OpenCode" },
		customAgents: [agent],
		lastUsedModels: {},
		lastUsedModes: {},
		lastUsedThoughtLevels: {},
	};
	const access = {
		getSnapshot: () => settings,
		updateSettings: vi.fn(async () => {}),
	} as unknown as ISettingsAccess;
	/** Flip the Kiro CLI engine setting, as the settings tab does. */
	const flip = (to: Engine) => {
		if (to === "v3") agent.engine = "v3";
		else delete agent.engine;
	};
	return { access, flip };
}

/**
 * A real AcpClient whose process spawn is stubbed. `doInitialize` returns
 * what the real converter makes of the agent's reply plus the config the
 * client was launched with.
 */
function makeClient() {
	const plugin = {
		settings: { autoAllowPermissions: false, windowsWslMode: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	const client = new AcpClient(plugin);
	const internals = client as unknown as {
		currentConfig: unknown;
		currentAgentId: string | null;
		isInitializedFlag: boolean;
		doInitialize: (config: { kiroEngine?: "v3" }) => Promise<unknown>;
		requireConnection: () => unknown;
	};
	vi.spyOn(internals, "doInitialize").mockImplementation(async (config) => {
		internals.currentConfig = config;
		internals.currentAgentId = AGENT;
		internals.isInitializedFlag = true;
		return AcpTypeConverter.toInitializeResult(RAW_INIT, config);
	});
	const request = vi.fn(async (method: string) =>
		method === "session/new" ? { sessionId: "s1" } : {},
	);
	vi.spyOn(internals, "requireConnection").mockReturnValue({ agent: { request } });
	return client;
}

const vault = {} as IVaultAccess & IMentionService;

async function launch(engine: Engine) {
	const { access, flip } = makeSettings(engine);
	const client = makeClient();
	const hook = renderHook(() => useAgent(client, access, vault, CWD, AGENT));
	await act(async () => {
		await hook.result.current.createSession();
	});
	return { hook, flip, client };
}

describe("I235: the launched Kiro engine travels with the session", () => {
	it("acp edge: initialize records v3 for a V3 launch and v2 otherwise", () => {
		expect(
			AcpTypeConverter.toInitializeResult(RAW_INIT, { kiroEngine: "v3" }).kiroEngine,
		).toBe("v3");
		expect(AcpTypeConverter.toInitializeResult(RAW_INIT, {}).kiroEngine).toBe("v2");
	});

	it("launched on V3, setting flipped to V2: the tooltip still names V3", async () => {
		const { hook, flip } = await launch("v3");
		expect(hook.result.current.session.kiroEngine).toBe("v3");

		flip("v2");
		hook.rerender();

		expect(hook.result.current.session.kiroEngine).toBe("v3");
		expect(deriveHeaderRuntime(hook.result.current.session)).toEqual({ kind: "kiroV3" });
	});

	it("launched on V2, setting flipped to V3: no V3 Runtime line appears", async () => {
		const { hook, flip } = await launch("v2");
		expect(hook.result.current.session.kiroEngine).toBe("v2");

		flip("v3");
		hook.rerender();

		expect(hook.result.current.session.kiroEngine).toBe("v2");
		expect(deriveHeaderRuntime(hook.result.current.session)).toEqual({ kind: "unknown" });
	});

	it("restored tab: load carries the launched engine from the cached init result", async () => {
		const { access } = makeSettings("v3");
		const client = makeClient();
		await client.initialize({
			id: AGENT, displayName: "Test Agent", command: "kiro-cli", args: ["acp"],
			env: [], workingDirectory: CWD, kiroEngine: "v3",
		} as unknown as Parameters<AcpClient["initialize"]>[0]);
		const hook = renderHook(() => useAgent(client, access, vault, CWD, AGENT));
		await act(async () => {
			await hook.result.current.updateSessionFromLoad("s1", undefined, undefined, undefined);
		});
		expect(hook.result.current.session.kiroEngine).toBe("v3");
	});

	it("lazy fresh tab: applyInitCapabilities carries the launched engine", async () => {
		const { access } = makeSettings("v3");
		const client = makeClient();
		await client.initialize({
			id: AGENT, displayName: "Test Agent", command: "kiro-cli", args: ["acp"],
			env: [], workingDirectory: CWD, kiroEngine: "v3",
		} as unknown as Parameters<AcpClient["initialize"]>[0]);
		const hook = renderHook(() => useAgent(client, access, vault, CWD, AGENT));
		act(() => hook.result.current.applyInitCapabilities());
		expect(hook.result.current.session.kiroEngine).toBe("v3");
	});
});
