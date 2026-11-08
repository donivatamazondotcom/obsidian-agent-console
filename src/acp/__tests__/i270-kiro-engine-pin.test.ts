/**
 * I270: the plugin's "V2 (legacy)" Kiro launch passed no engine flag, so
 * kiro-cli followed Kiro's own engine setting and ran V3 under a V2 label
 * (probe 2026-11-06, kiro-cli 3.0.1-nightly.4: plain `acp` advertised
 * session/list and minted `sess_…` ids; `--agent-engine=v2` had neither).
 *
 * Pure seams: the launch args every spawn uses (`resolveLaunchArgs`), the
 * config builder every tab launches through (`buildAgentConfigWithApiKey`),
 * and the startup-failure classifier the old-CLI relaunch keys off.
 *
 * Red-first (R1): on main `prepareKiroV2Launch` doesn't exist, a V2 config
 * launches with the user's args untouched, and the built-in Kiro agent on V2
 * gets no `kiroEngine`.
 */
import { describe, it, expect } from "vitest";
import {
	prepareKiroV2Launch,
	resolveLaunchArgs,
} from "../kiro-v3";
import { classifyKiroStartupFailure } from "../kiro-startup-failure";
import { buildAgentConfigWithApiKey } from "../../services/session-helpers";
import { DEFAULT_SETTINGS } from "../../services/settings-normalizer";
import type { AgentConfig } from "../acp-client";
import type { AgentClientPluginSettings } from "../../plugin";

const cfg = (
	args: string[],
	kiroEngine?: "v2" | "v3",
	command = "kiro-cli",
): AgentConfig =>
	({
		id: "x",
		displayName: "X",
		command,
		args,
		workingDirectory: "/vault",
		...(kiroEngine ? { kiroEngine } : {}),
	}) as AgentConfig;

describe("prepareKiroV2Launch", () => {
	it("pins V2 right after acp and keeps the V2-only flags", () => {
		expect(
			prepareKiroV2Launch(["acp", "--agent", "auto-sa", "--trust-all-tools"]),
		).toEqual(["acp", "--agent-engine=v2", "--agent", "auto-sa", "--trust-all-tools"]);
	});

	it("replaces an engine the user set, inline or as a separate value", () => {
		expect(prepareKiroV2Launch(["acp", "--agent-engine=v3"])).toEqual([
			"acp",
			"--agent-engine=v2",
		]);
		expect(prepareKiroV2Launch(["acp", "--agent-engine", "v3", "--model", "auto"])).toEqual(
			["acp", "--agent-engine=v2", "--model", "auto"],
		);
	});

	it("inserts after the positional acp, not an acp that is a flag's value", () => {
		expect(prepareKiroV2Launch(["--agent", "acp", "acp"])).toEqual([
			"--agent",
			"acp",
			"acp",
			"--agent-engine=v2",
		]);
	});

	it("appends when there is no acp subcommand", () => {
		expect(prepareKiroV2Launch([])).toEqual(["--agent-engine=v2"]);
	});
});

describe("resolveLaunchArgs (I270)", () => {
	it("a V2 config is pinned", () => {
		expect(resolveLaunchArgs(cfg(["acp"], "v2"))).toEqual(["acp", "--agent-engine=v2"]);
	});

	it("an unpinned V2 relaunch drops every engine flag", () => {
		expect(
			resolveLaunchArgs(cfg(["acp", "--agent-engine=v2", "--agent", "a"], "v2"), {
				pinEngine: false,
			}),
		).toEqual(["acp", "--agent", "a"]);
	});

	it("a non-Kiro launch is untouched", () => {
		expect(resolveLaunchArgs(cfg(["--acp"], undefined, "claude-code-acp"))).toEqual([
			"--acp",
		]);
	});

	it("V3 is unchanged", () => {
		expect(resolveLaunchArgs(cfg(["acp", "--agent", "a"], "v3"))).toEqual([
			"acp",
			"--agent-engine=v3",
		]);
	});
});

describe("buildAgentConfigWithApiKey pins the Kiro engine (I270)", () => {
	const base = (over: Partial<AgentClientPluginSettings> = {}) =>
		({ ...DEFAULT_SETTINGS, ...over }) as AgentClientPluginSettings;

	it("the built-in Kiro agent on V2 launches kiroEngine v2, whatever its command", () => {
		for (const command of ["kiro-cli", "/opt/bin/my-kiro-wrapper.sh"]) {
			const settings = base({ kiro: { ...DEFAULT_SETTINGS.kiro, engine: "v2", command } });
			const c = buildAgentConfigWithApiKey(settings, settings.kiro, settings.kiro.id, "/v");
			expect(c.kiroEngine).toBe("v2");
		}
	});

	it("a custom kiro-cli agent on V2 is pinned; a custom non-Kiro agent is not", () => {
		const kiroCustom = {
			id: "kiro-work",
			displayName: "Kiro work",
			command: "/usr/local/bin/kiro-cli",
			args: ["acp"],
			env: [],
			engine: "v2" as const,
		};
		const other = {
			id: "my-agent",
			displayName: "Mine",
			command: "/usr/local/bin/my-agent",
			args: [],
			env: [],
		};
		const otherWithV2 = { ...other, id: "was-kiro", engine: "v2" as const };
		const settings = base({ customAgents: [kiroCustom, other, otherWithV2] } as never);
		// A stored V2 on a non-Kiro command (left over from an edit) adds no flag.
		expect(
			buildAgentConfigWithApiKey(settings, otherWithV2 as never, otherWithV2.id, "/v")
				.kiroEngine,
		).toBeUndefined();
		expect(
			buildAgentConfigWithApiKey(settings, kiroCustom as never, kiroCustom.id, "/v").kiroEngine,
		).toBe("v2");
		expect(
			buildAgentConfigWithApiKey(settings, other as never, other.id, "/v").kiroEngine,
		).toBeUndefined();
	});

	it("Claude Code gets no engine", () => {
		const settings = base();
		expect(
			buildAgentConfigWithApiKey(settings, settings.claude, settings.claude.id, "/v")
				.kiroEngine,
		).toBeUndefined();
	});
});

describe("classifyKiroStartupFailure (I270)", () => {
	const CLAP =
		"error: unexpected argument '--agent-engine' found\n\n  tip: to pass '--agent-engine' as a value, use '-- --agent-engine'\n";

	it("a V2 launch rejected for the flag by an old CLI is engine-flag-unknown", () => {
		expect(
			classifyKiroStartupFailure({ launchedEngine: "v2", exitCode: 2, stderr: CLAP }),
		).toBe("engine-flag-unknown");
	});

	it("clap 3's wording for an unknown flag counts too", () => {
		expect(
			classifyKiroStartupFailure({
				launchedEngine: "v2",
				exitCode: 2,
				stderr:
					"error: Found argument '--agent-engine' which wasn't expected, or isn't valid in this context\n",
			}),
		).toBe("engine-flag-unknown");
	});

	it("a V2 failure that only mentions the flag is not", () => {
		expect(
			classifyKiroStartupFailure({
				launchedEngine: "v2",
				exitCode: 2,
				stderr: "error: invalid value 'v2' for '--agent-engine <ENGINE>'",
			}),
		).toBeNull();
		expect(
			classifyKiroStartupFailure({ launchedEngine: "v2", exitCode: 1, stderr: CLAP }),
		).toBeNull();
	});

	it("V3 gets the narrow kind for clap's unknown flag, the broad one otherwise (I302)", () => {
		expect(
			classifyKiroStartupFailure({ launchedEngine: "v3", exitCode: 2, stderr: CLAP }),
		).toBe("engine-flag-unknown");
		expect(
			classifyKiroStartupFailure({ launchedEngine: "v3", exitCode: 1, stderr: CLAP }),
		).toBe("engine-unsupported");
	});
});
