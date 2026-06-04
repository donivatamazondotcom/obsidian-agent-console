/**
 * Unit tests for the Kiro CLI built-in agent wiring.
 *
 * Kiro is a first-class built-in (like claude/codex/gemini) but authenticates
 * via Kiro account sign-in, so it carries no apiKeySecretId and must fall
 * through buildAgentConfigWithApiKey without an injected API key.
 */

import { describe, it, expect } from "vitest";
import {
	getAvailableAgentsFromSettings,
	findAgentSettings,
	buildAgentConfigWithApiKey,
} from "../session-helpers";
import type { AgentClientPluginSettings } from "../../plugin";

const settings = {
	claude: {
		id: "claude-code-acp",
		displayName: "Claude Code",
		apiKeySecretId: "",
		command: "claude-agent-acp",
		args: [],
		env: [],
	},
	codex: {
		id: "codex-acp",
		displayName: "Codex",
		apiKeySecretId: "",
		command: "codex-acp",
		args: [],
		env: [],
	},
	gemini: {
		id: "gemini-cli",
		displayName: "Gemini CLI",
		apiKeySecretId: "",
		command: "gemini",
		args: ["--experimental-acp"],
		env: [],
	},
	kiro: {
		id: "kiro-cli",
		displayName: "Kiro CLI",
		command: "kiro-cli",
		args: ["acp"],
		env: [],
	},
	customAgents: [],
} as unknown as AgentClientPluginSettings;

describe("Kiro CLI built-in agent", () => {
	it("is enumerated as an available agent after the other built-ins", () => {
		const ids = getAvailableAgentsFromSettings(settings).map((a) => a.id);
		expect(ids).toEqual([
			"claude-code-acp",
			"codex-acp",
			"gemini-cli",
			"kiro-cli",
		]);
	});

	it("resolves via findAgentSettings by its id", () => {
		const found = findAgentSettings(settings, "kiro-cli");
		expect(found).toBe(settings.kiro);
		expect(found?.command).toBe("kiro-cli");
		expect(found?.args).toEqual(["acp"]);
	});

	it("builds an agent config with NO api key (account sign-in, not API key)", () => {
		const cfg = buildAgentConfigWithApiKey(
			settings,
			settings.kiro,
			"kiro-cli",
			"/tmp/x",
		);
		expect(cfg).not.toHaveProperty("apiKey");
		expect(cfg.command).toBe("kiro-cli");
		expect(cfg.args).toEqual(["acp"]);
	});
});
