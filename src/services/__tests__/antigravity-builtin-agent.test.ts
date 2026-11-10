/**
 * Antigravity CLI built-in agent wiring.
 *
 * Antigravity CLI (`agy`) replaces Gemini CLI for Google's individual tiers
 * and ships a native ACP server (`agy acp`). It is a link-only built-in (like
 * OpenCode and Kiro CLI): it installs through Google's own installer, signs in
 * through its own cached login, and takes an OPTIONAL secret-backed API key
 * that is passed as GEMINI_API_KEY only when one is set.
 *
 * Spec: [[Antigravity CLI Built-in Support]] § Spec (approved 2026-11-10).
 */

import { describe, it, expect } from "vitest";
import {
	getAvailableAgentsFromSettings,
	findAgentSettings,
	buildAgentConfigWithApiKey,
	buildAgentDetectionCandidates,
} from "../session-helpers";
import { DEFAULT_SETTINGS, normalizeRawSettings as normalize } from "../settings-normalizer";

/** Load raw settings the way plugin.ts does; secret ids pass through unchanged. */
const normalizeRawSettings = (raw: Record<string, unknown>) =>
	normalize(raw, DEFAULT_SETTINGS, (_a: string, _b: string, current: string) => current);
import {
	BUILTIN_AGENT_INSTALLS,
	DOCS_AGENT_SETUP_BASE,
	docsSetupUrl,
} from "../agent-packages";
import {
	DEFAULT_AGENT_PRIORITY,
	detectAvailableAgents,
	pickDefaultAgentId,
} from "../agent-detection";
import { builtInAgentIds } from "../builtin-agents";
import type { AgentClientPluginSettings } from "../../plugin";

const ID = "antigravity-acp";

function settingsWith(
	antigravity: Partial<AgentClientPluginSettings["antigravity"]> = {},
): AgentClientPluginSettings {
	return {
		...DEFAULT_SETTINGS,
		antigravity: { ...DEFAULT_SETTINGS.antigravity, ...antigravity },
	};
}

describe("Antigravity CLI built-in agent", () => {
	it("ships in DEFAULT_SETTINGS launching `agy acp` with no key set", () => {
		expect(DEFAULT_SETTINGS.antigravity).toMatchObject({
			id: ID,
			displayName: "Antigravity CLI",
			command: "agy",
			args: ["acp"],
			env: [],
			apiKeySecretId: "",
		});
	});

	it("is enumerated after OpenCode, before custom agents", () => {
		const ids = getAvailableAgentsFromSettings(DEFAULT_SETTINGS).map((a) => a.id);
		expect(ids).toEqual([
			"claude-code-acp",
			"codex-acp",
			"gemini-cli",
			"kiro-cli",
			"opencode-acp",
			ID,
		]);
	});

	it("resolves via findAgentSettings", () => {
		const s = settingsWith();
		expect(findAgentSettings(s, ID)).toBe(s.antigravity);
	});

	it("passes no API key when no secret is set (a signed-in launch is unchanged)", () => {
		const s = settingsWith();
		const cfg = buildAgentConfigWithApiKey(s, s.antigravity, ID, "/tmp/x");
		expect(cfg.apiKey).toBeUndefined();
		expect(cfg.command).toBe("agy");
		expect(cfg.args).toEqual(["acp"]);
	});

	it("passes the secret as GEMINI_API_KEY when one is set", () => {
		const s = settingsWith({ apiKeySecretId: "my-agy-key" });
		const cfg = buildAgentConfigWithApiKey(s, s.antigravity, ID, "/tmp/x");
		expect(cfg.apiKey).toEqual({ secretId: "my-agy-key", envVarName: "GEMINI_API_KEY" });
	});

	it("keeps its fields across a settings load", () => {
		const loaded = normalizeRawSettings({
			antigravity: {
				command: "/opt/homebrew/bin/agy",
				args: ["acp", "--disable-telemetry"],
				apiKeySecretId: "my-agy-key",
				defaultWorkingDirectory: "/work",
			},
		});
		expect(loaded.antigravity).toMatchObject({
			id: ID,
			command: "/opt/homebrew/bin/agy",
			args: ["acp", "--disable-telemetry"],
			apiKeySecretId: "my-agy-key",
			defaultWorkingDirectory: "/work",
		});
	});

	it("falls back to the defaults for a missing or malformed entry", () => {
		expect(normalizeRawSettings({}).antigravity).toMatchObject({
			id: ID,
			command: "agy",
			args: ["acp"],
			apiKeySecretId: "",
		});
		expect(
			normalizeRawSettings({ antigravity: { id: "hijack", command: 7, args: 7 } }).antigravity,
		).toMatchObject({ id: ID, command: "agy", args: ["acp"] });
	});

	it("is a link-only install entry with the antigravity-cli docs slug", () => {
		const entry = BUILTIN_AGENT_INSTALLS.find((a) => a.id === ID);
		expect(entry).toEqual({
			id: ID,
			displayName: "Antigravity CLI",
			docsSlug: "antigravity-cli",
			npmPackage: null,
		});
		expect(docsSetupUrl(entry!.docsSlug)).toBe(`${DOCS_AGENT_SETUP_BASE}/antigravity-cli`);
	});

	it("is preferred over Gemini CLI on a fresh install, behind Kiro, Claude and Codex", () => {
		const order = [...DEFAULT_AGENT_PRIORITY];
		expect(order.indexOf(ID)).toBeGreaterThan(order.indexOf("codex-acp"));
		expect(order.indexOf(ID)).toBe(order.indexOf("gemini-cli") - 1);
	});

	it("every priority entry is a built-in agent id (not a docs slug)", () => {
		const ids = new Set(builtInAgentIds(DEFAULT_SETTINGS));
		for (const id of DEFAULT_AGENT_PRIORITY) expect(ids.has(id)).toBe(true);
	});

	it("a fresh install with only agy and gemini defaults to Antigravity CLI", async () => {
		const found = new Set(["agy", "gemini"]);
		const detected = await detectAvailableAgents(
			buildAgentDetectionCandidates(DEFAULT_SETTINGS),
			async (cmd) => (found.has(cmd) ? `/bin/${cmd}` : null),
		);
		expect(pickDefaultAgentId(detected)).toBe(ID);
	});

	it("does not take an id a user's custom agent is likely to hold", () => {
		expect(["antigravity", "agy", "antigravity-cli"]).not.toContain(ID);
	});
});
