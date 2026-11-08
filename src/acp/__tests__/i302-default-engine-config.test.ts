/**
 * I302: which launches may fall back to V2 on a kiro-cli too old for V3, and
 * what the fallback launch looks like.
 *
 * Pure seams (R2): the config builder every tab launches through
 * (`buildAgentConfigWithApiKey`), the relaunch config (`relaunchConfig`), and
 * the `acp/` edge that turns a launch into the InitializeResult the session
 * reads (`toInitializeResult`).
 *
 * Red-first (R1): on main no config carries `kiroEngineFollowsDefault`,
 * `relaunchConfig` doesn't exist, and InitializeResult has no fallback.
 */
import { describe, it, expect } from "vitest";
import { relaunchConfig, resolveLaunchArgs } from "../kiro-v3";
import { AcpTypeConverter } from "../type-converter";
import { buildAgentConfigWithApiKey } from "../../services/session-helpers";
import { DEFAULT_SETTINGS } from "../../services/settings-normalizer";
import type { AgentConfig } from "../acp-client";
import type { AgentClientPluginSettings } from "../../plugin";

const base = (over: Partial<AgentClientPluginSettings> = {}) =>
	({ ...DEFAULT_SETTINGS, ...over }) as AgentClientPluginSettings;

const kiroWith = (engine: "default" | "v2" | "v3") => {
	const settings = base({ kiro: { ...DEFAULT_SETTINGS.kiro, engine } });
	return buildAgentConfigWithApiKey(settings, settings.kiro, settings.kiro.id, "/v");
};

describe("buildAgentConfigWithApiKey marks Default V3 launches (I302)", () => {
	it("built-in Kiro: only Default sets kiroEngineFollowsDefault", () => {
		expect(kiroWith("default")).toMatchObject({
			kiroEngine: "v3",
			kiroEngineFollowsDefault: true,
		});
		expect(kiroWith("v3").kiroEngine).toBe("v3");
		expect(kiroWith("v3").kiroEngineFollowsDefault).toBeUndefined();
		expect(kiroWith("v2").kiroEngine).toBe("v2");
		expect(kiroWith("v2").kiroEngineFollowsDefault).toBeUndefined();
	});

	it("custom agents: a kiro-cli agent on Default follows it; V3 by name and non-Kiro don't", () => {
		const kiroDefault = {
			id: "kiro-work",
			displayName: "Kiro work",
			command: "/usr/local/bin/kiro-cli",
			args: ["acp"],
			env: [],
		};
		const kiroV3 = { ...kiroDefault, id: "kiro-v3", engine: "v3" as const };
		const other = {
			id: "my-agent",
			displayName: "Mine",
			command: "/usr/local/bin/my-agent",
			args: [],
			env: [],
		};
		const settings = base({ customAgents: [kiroDefault, kiroV3, other] } as never);
		const build = (a: { id: string }) =>
			buildAgentConfigWithApiKey(settings, a as never, a.id, "/v");
		expect(build(kiroDefault)).toMatchObject({
			kiroEngine: "v3",
			kiroEngineFollowsDefault: true,
		});
		expect(build(kiroV3).kiroEngineFollowsDefault).toBeUndefined();
		expect(build(other).kiroEngine).toBeUndefined();
		expect(build(other).kiroEngineFollowsDefault).toBeUndefined();
	});

	it("Claude Code is never marked", () => {
		const settings = base();
		const c = buildAgentConfigWithApiKey(settings, settings.claude, settings.claude.id, "/v");
		expect(c.kiroEngineFollowsDefault).toBeUndefined();
	});
});

const cfg = (over: Partial<AgentConfig>): AgentConfig => ({
	id: "kiro",
	displayName: "Kiro",
	command: "kiro-cli",
	args: ["acp", "--agent", "auto-sa", "--model", "m"],
	env: {},
	workingDirectory: "/v",
	...over,
});

describe("relaunchConfig (I270, I302)", () => {
	it("a V2 config relaunches as is", () => {
		const v2 = cfg({ kiroEngine: "v2" });
		expect(relaunchConfig(v2)).toBe(v2);
	});

	it("a Default V3 config relaunches as a V2 fallback, keeping the user's args", () => {
		const out = relaunchConfig(cfg({ kiroEngine: "v3", kiroEngineFollowsDefault: true }));
		expect(out.kiroEngine).toBe("v2");
		expect(out.kiroEngineFallback).toBe("old-cli");
		expect(out.kiroEngineFollowsDefault).toBeUndefined();
		// Unpinned V2 launch: no engine flag, --agent and --model stay.
		expect(resolveLaunchArgs(out, { pinEngine: false })).toEqual([
			"acp",
			"--agent",
			"auto-sa",
			"--model",
			"m",
		]);
	});
});

describe("toInitializeResult carries the fallback (I302)", () => {
	const reply = { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } as never;

	it("a fallback V2 launch reports kiroEngine v2 and the fallback", () => {
		const r = AcpTypeConverter.toInitializeResult(reply, {
			kiroEngine: "v2",
			command: "kiro-cli",
			kiroEngineFallback: "old-cli",
		});
		expect(r.kiroEngine).toBe("v2");
		expect(r.kiroCli).toBe(true);
		expect(r.kiroEngineFallback).toBe("old-cli");
	});

	it("a V3 or plain V2 launch has no fallback", () => {
		expect(
			AcpTypeConverter.toInitializeResult(reply, { kiroEngine: "v3", command: "kiro-cli" })
				.kiroEngineFallback,
		).toBeUndefined();
		expect(
			AcpTypeConverter.toInitializeResult(reply, { kiroEngine: "v2", command: "kiro-cli" })
				.kiroEngineFallback,
		).toBeUndefined();
	});
});
