/**
 * Kiro CLI V3 support — S1: launch, initialize capabilities, mode selection.
 *
 * The v3 ACP server rejects v2-only launch flags, selects the agent per
 * session (mode), and runs agent hooks over ACP only when the client
 * advertises `_meta.kiro.hooks {enabled, v2}`. The engine is chosen by
 * setting, never inferred (both generations negotiate protocol version 1).
 *
 * Spec: [[Kiro CLI V3 Support]] (T1, T2, T3).
 */
import { describe, it, expect, vi } from "vitest";
import * as acp from "@agentclientprotocol/sdk";
import {
	prepareKiroV3Launch,
	resolveLaunchArgs,
	buildClientCapabilities,
	kiroV3SessionMeta,
	resolveKiroEngine,
} from "../kiro-v3";
import {
	A2UI_CAPABILITY_META_KEY,
	buildA2uiCapabilityMeta,
} from "../../services/a2ui/capability";

const a2ui = { [A2UI_CAPABILITY_META_KEY]: buildA2uiCapabilityMeta() };
import { AcpClient, type AgentConfig } from "../acp-client";
import type AgentClientPlugin from "../../plugin";
import {
	normalizeRawSettings,
	DEFAULT_SETTINGS,
} from "../../services/settings-normalizer";
import { buildAgentConfigWithApiKey } from "../../services/session-helpers";

const idKey = (_d: string, _f: string, current: string) => current;

const cfg = (args: string[], kiroEngine?: "v3"): AgentConfig => ({
	id: "kiro-cli",
	displayName: "Kiro CLI",
	command: "kiro-cli",
	args,
	workingDirectory: "/vault",
	...(kiroEngine ? { kiroEngine } : {}),
});

describe("prepareKiroV3Launch (T1)", () => {
	it("moves --agent into the session as modeId and adds the engine flag", () => {
		const r = prepareKiroV3Launch(["acp", "--agent", "auto-sa"]);
		expect(r.args).toEqual(["acp", "--agent-engine=v3"]);
		expect(r.sessionMeta).toEqual({ modeId: "auto-sa" });
		expect(r.stripped).toEqual(["--agent"]);
	});

	it("handles --flag=value, model, effort and both trust flags", () => {
		const r = prepareKiroV3Launch([
			"acp",
			"--agent=auto-sa",
			"--model",
			"claude-opus-4.8",
			"--effort=high",
			"--trust-all-tools",
			"--trust-tools",
			"read,grep",
			"--verbose",
		]);
		expect(r.args).toEqual(["acp", "--agent-engine=v3", "--verbose"]);
		expect(r.sessionMeta).toEqual({
			modeId: "auto-sa",
			modelId: "claude-opus-4.8",
			effortLevel: "high",
		});
		expect(r.stripped).toEqual([
			"--agent",
			"--model",
			"--effort",
			"--trust-all-tools",
			"--trust-tools",
		]);
	});

	it("never leaves a v2-only flag or a second engine flag", () => {
		const r = prepareKiroV3Launch([
			"acp",
			"--agent-engine",
			"v2",
			"--trust-tools=read",
			"--agent-engine=v1",
		]);
		expect(r.args).toEqual(["acp", "--agent-engine=v3"]);
		for (const bad of ["--agent", "--model", "--effort", "--trust-all-tools", "--trust-tools"]) {
			expect(r.args.some((a) => a === bad || a.startsWith(`${bad}=`))).toBe(false);
		}
	});

	it("appends the engine flag when there is no acp subcommand", () => {
		expect(prepareKiroV3Launch([]).args).toEqual(["--agent-engine=v3"]);
	});
});

describe("resolveLaunchArgs (T2)", () => {
	it("leaves v2 / non-Kiro args exactly as configured", () => {
		const args = ["acp", "--agent", "auto-sa", "--trust-all-tools"];
		expect(resolveLaunchArgs(cfg(args))).toEqual(args);
	});

	it("rewrites args only when the config asks for the v3 engine", () => {
		expect(resolveLaunchArgs(cfg(["acp", "--agent", "auto-sa"], "v3"))).toEqual([
			"acp",
			"--agent-engine=v3",
		]);
	});
});

describe("buildClientCapabilities (T3)", () => {
	it("v2: no Kiro capability, a2ui still advertised", () => {
		const caps = buildClientCapabilities(cfg(["acp"]), a2ui);
		expect(caps._meta).toHaveProperty(A2UI_CAPABILITY_META_KEY);
		expect(caps._meta).not.toHaveProperty("kiro");
		expect(caps.terminal).toBe(true);
	});

	it("v3: asks the server to run the agent's hooks", () => {
		const caps = buildClientCapabilities(cfg(["acp"], "v3"), a2ui);
		expect(caps._meta).toHaveProperty(A2UI_CAPABILITY_META_KEY);
		expect(caps._meta?.kiro).toEqual({ hooks: { enabled: true, v2: true } });
	});
});

describe("kiroV3SessionMeta", () => {
	it("is empty for v2 and for v3 with nothing to carry", () => {
		expect(kiroV3SessionMeta(cfg(["acp", "--agent", "x"]))).toEqual({});
		expect(kiroV3SessionMeta(cfg(["acp"], "v3"))).toEqual({});
	});
	it("carries the launch-derived values under _meta.kiro", () => {
		expect(kiroV3SessionMeta(cfg(["acp", "--agent", "auto-sa"], "v3"))).toEqual({
			_meta: { kiro: { modeId: "auto-sa" } },
		});
	});
});

describe("AcpClient.newSession on the live request path", () => {
	function makeClient(config: AgentConfig) {
		const plugin = {
			settings: { autoAllowPermissions: false, windowsWslMode: false },
			manifest: { version: "0.0.0-test" },
		} as unknown as AgentClientPlugin;
		const client = new AcpClient(plugin);
		const seams = client as unknown as { connection: unknown; currentConfig: AgentConfig };
		const request = vi.fn(async () => ({ sessionId: "S1" }));
		seams.connection = { agent: { request, notify: vi.fn() } };
		seams.currentConfig = config;
		return { client, request };
	}

	it("v3: session/new selects the agent as a mode", async () => {
		const { client, request } = makeClient(cfg(["acp", "--agent", "auto-sa"], "v3"));
		await client.newSession("/vault");
		expect(request).toHaveBeenCalledWith(
			acp.methods.agent.session.new,
			expect.objectContaining({ _meta: { kiro: { modeId: "auto-sa" } } }),
		);
	});

	it("v2: session/new params are unchanged (no _meta)", async () => {
		const { client, request } = makeClient(cfg(["acp", "--agent", "auto-sa"]));
		await client.newSession("/vault");
		const params = (request.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
		expect(params).not.toHaveProperty("_meta");
	});
});

describe("Kiro engine setting", () => {
	it("defaults to v2 and keeps an explicit v3", () => {
		expect(normalizeRawSettings({}, DEFAULT_SETTINGS, idKey).kiro.engine).toBe("v2");
		expect(
			normalizeRawSettings({ kiro: { engine: "v3" } }, DEFAULT_SETTINGS, idKey).kiro.engine,
		).toBe("v3");
		expect(
			normalizeRawSettings({ kiro: { engine: "bogus" } }, DEFAULT_SETTINGS, idKey).kiro.engine,
		).toBe("v2");
	});

	it("resolveKiroEngine is total", () => {
		expect(resolveKiroEngine({ engine: "v3" })).toBe("v3");
		expect(resolveKiroEngine({ engine: "v2" })).toBe("v2");
		expect(resolveKiroEngine({})).toBe("v2");
	});

	it("the Kiro agent config carries the v3 intent only when v3 is selected", () => {
		const s = normalizeRawSettings({ kiro: { engine: "v3" } }, DEFAULT_SETTINGS, idKey);
		expect(buildAgentConfigWithApiKey(s, s.kiro, s.kiro.id, "/vault").kiroEngine).toBe("v3");
		const d = normalizeRawSettings({}, DEFAULT_SETTINGS, idKey);
		expect(buildAgentConfigWithApiKey(d, d.kiro, d.kiro.id, "/vault").kiroEngine).toBeUndefined();
		expect(
			buildAgentConfigWithApiKey(s, s.claude, s.claude.id, "/vault").kiroEngine,
		).toBeUndefined();
	});
});
