/**
 * D3 (Agent Console v2.5.0): an older kiro-cli rejects
 * `acp --agent-engine=v3`. The chat must say why, instead of
 * "Session Creation Failed: ACP connection closed".
 *
 * Measured 2026-11-02 (see [[Kiro CLI V3 Support]] § Known Issues): clap
 * prints `error: unexpected argument '--agent-engine' found` and exits 2 in
 * ~0.2 s. The SDK then rejects `initialize` with a generic
 * "ACP connection closed", and the stderr reason never reaches the user.
 *
 * Seams (R2): a real AcpClient and the real useAgent hook spawn a real stub
 * `kiro-cli` (a shell script) through the real launch path. Nothing in the
 * client is stubbed. Assertions are on what the tab shows: errorInfo and
 * session state (R3).
 *
 * Red-first (R1): on main every D3 assertion fails with the generic
 * "Session Creation Failed" / "ACP connection closed" text.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useAgent } from "../useAgent";
import { useLazySession } from "../useLazySession";
import { AcpClient } from "../../acp/acp-client";
import type AgentClientPlugin from "../../plugin";
import type { ISettingsAccess } from "../../services/settings-service";
import type { IVaultAccess } from "../../services/vault-service";
import type { IMentionService } from "../../utils/mention-parser";

const AGENT = "kiro-old";
const D3_TITLE = "Kiro CLI needs an update";

let dir: string;
let stub: string;
let argvLog: string;

/**
 * An old kiro-cli: rejects any `--agent-engine` the way clap does (exit 2,
 * stderr only). Without the flag it fails for an unrelated reason, so the
 * V2 path can be checked without a real agent.
 */
const STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$(dirname "$0")/argv.log"
for a in "$@"; do
  case "$a" in
    --agent-engine*)
      printf "error: unexpected argument '--agent-engine' found\\n\\n  tip: to pass '--agent-engine' as a value, use '-- --agent-engine'\\n\\nUsage: kiro-cli acp [OPTIONS]\\n\\nFor more information, try '--help'.\\n" >&2
      exit 2
      ;;
  esac
done
echo "error: something unrelated broke" >&2
exit 1
`;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "d3-kiro-"));
	stub = join(dir, "kiro-cli");
	argvLog = join(dir, "argv.log");
	writeFileSync(stub, STUB);
	chmodSync(stub, 0o755);
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

function makeSettings(engine: "v2" | "v3") {
	const agent: Record<string, unknown> = {
		id: AGENT,
		displayName: "Kiro (old CLI)",
		command: stub,
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
		customAgents: [agent],
		lastUsedModels: {},
		lastUsedModes: {},
		lastUsedThoughtLevels: {},
	};
	const access = {
		getSnapshot: () => settings,
		updateSettings: vi.fn(async () => {}),
	} as unknown as ISettingsAccess;
	return {
		access,
		/** Switch the agent's engine, as the settings tab does. */
		setEngine: (to: "v2" | "v3") => {
			agent.engine = to;
		},
	};
}

function makeClient(): AcpClient {
	const plugin = {
		settings: { autoAllowPermissions: false, windowsWslMode: false, nodePath: "" },
		manifest: { version: "0.0.0-test" },
		app: { secretStorage: { getSecret: () => null } },
	} as unknown as AgentClientPlugin;
	return new AcpClient(plugin);
}

const vault = {} as IVaultAccess & IMentionService;

function v3Config() {
	return {
		id: AGENT,
		displayName: "Kiro (old CLI)",
		command: stub,
		args: ["acp"],
		env: {},
		workingDirectory: dir,
		kiroEngine: "v3" as const,
	} as unknown as Parameters<AcpClient["initialize"]>[0];
}

describe("D3: older kiro-cli without V3", () => {
	it("AcpClient: a V3 launch the CLI rejects fails with the D3 reason, not 'ACP connection closed'", async () => {
		const client = makeClient();
		const err = await client.initialize(v3Config()).then(
			() => null,
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(Error);
		const info = (err as { info?: { title?: string; message?: string; suggestion?: string } }).info;
		expect(info?.title).toBe(D3_TITLE);
		expect(info?.message).toMatch(/doesn't support the V3 engine/);
		expect(info?.suggestion).toMatch(/kiro-cli update/);
		expect(info?.suggestion).toMatch(/Kiro CLI engine/);
		expect(info?.suggestion).toMatch(/V2 \(legacy\)/);
		// H3: the user changed the wrong agent's engine; name this one.
		expect(info?.suggestion).toMatch(/in the settings for Kiro \(old CLI\)\./);
		await client.whenTornDown();
	}, 20_000);

	it("tab: a fresh session on an old CLI shows the D3 error and leaves the connecting state", async () => {
		const { access } = makeSettings("v3");
		const client = makeClient();
		const hook = renderHook(() => useAgent(client, access, vault, dir, AGENT));
		await act(async () => {
			await hook.result.current.createSession();
		});
		expect(hook.result.current.session.state).toBe("error");
		expect(hook.result.current.errorInfo?.title).toBe(D3_TITLE);
		expect(hook.result.current.errorInfo?.suggestion).toMatch(/V2 \(legacy\)/);
		await client.whenTornDown();
	}, 20_000);

	it("an unrelated startup failure keeps the generic error (no false D3)", async () => {
		const { access } = makeSettings("v2");
		const client = makeClient();
		const hook = renderHook(() => useAgent(client, access, vault, dir, AGENT));
		await act(async () => {
			await hook.result.current.createSession();
		});
		expect(hook.result.current.session.state).toBe("error");
		expect(hook.result.current.errorInfo?.title).not.toBe(D3_TITLE);
		await client.whenTornDown();
	}, 20_000);

	it("retry after switching the agent to V2: pinned, then relaunched without --agent-engine (I270)", async () => {
		if (existsSync(argvLog)) rmSync(argvLog);
		const { access, setEngine } = makeSettings("v3");
		const client = makeClient();
		const hook = renderHook(() => useAgent(client, access, vault, dir, AGENT));
		await act(async () => {
			await hook.result.current.createSession();
		});
		expect(hook.result.current.errorInfo?.title).toBe(D3_TITLE);

		setEngine("v2");
		await act(async () => {
			await hook.result.current.createSession();
		});
		const launches = readFileSync(argvLog, "utf8").trim().split("\n");
		// V3 (rejected), then V2 pinned (rejected by this old CLI), then the
		// one unpinned relaunch, which fails for the stub's unrelated reason.
		expect(launches).toHaveLength(3);
		expect(launches[0]).toMatch(/--agent-engine=v3/);
		expect(launches[1]).toMatch(/--agent-engine=v2/);
		expect(launches[2]).not.toMatch(/--agent-engine/);
		expect(hook.result.current.errorInfo?.title).not.toBe(D3_TITLE);
		await client.whenTornDown();
	}, 30_000);

	it("fresh tab, eager initialize: the D3 failure is applied to the tab (not swallowed)", async () => {
		const { access } = makeSettings("v3");
		const client = makeClient();
		const hook = renderHook(() => useAgent(client, access, vault, dir, AGENT));
		const err = await client.initialize(v3Config()).then(
			() => null,
			(e: unknown) => e,
		);
		let applied = false;
		act(() => {
			applied = hook.result.current.applyInitFailure(err);
		});
		expect(applied).toBe(true);
		expect(hook.result.current.session.state).toBe("error");
		expect(hook.result.current.errorInfo?.title).toBe(D3_TITLE);
		await client.whenTornDown();
	}, 20_000);

	it("fresh tab, eager initialize: any other failure stays non-fatal", () => {
		const { access } = makeSettings("v3");
		const client = makeClient();
		const hook = renderHook(() => useAgent(client, access, vault, dir, AGENT));
		let applied = true;
		act(() => {
			applied = hook.result.current.applyInitFailure(new Error("ACP connection closed"));
		});
		expect(applied).toBe(false);
		expect(hook.result.current.errorInfo).toBeNull();
	});

	it("lazy session: markConnectFailed moves an idle tab to error", () => {
		const acquireNewSession = vi.fn(async () => ({ ok: true as const, sessionId: "s1" }));
		const hook = renderHook(() =>
			useLazySession({
				restoredSessionId: null,
				acquireNewSession,
				loadExistingSession: vi.fn(),
				sendPrompt: vi.fn(),
			} as unknown as Parameters<typeof useLazySession>[0]),
		);
		expect(hook.result.current.state).toBe("idle");
		act(() => hook.result.current.markConnectFailed());
		expect(hook.result.current.state).toBe("error");
	});
});
