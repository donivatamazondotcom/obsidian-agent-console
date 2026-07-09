/**
 * Unit tests for the OpenCode built-in agent wiring.
 *
 * OpenCode is a link-only built-in (like Kiro CLI): it ships through its own
 * installer, not npm, and chooses its model backend (e.g. a local ollama
 * provider) through its OWN config — never through the plugin. So it carries
 * no apiKeySecretId, launches via `opencode acp`, and must fall through
 * buildAgentConfigWithApiKey without an injected API key.
 */

import { describe, it, expect } from "vitest";
import {
	getAvailableAgentsFromSettings,
	findAgentSettings,
	buildAgentConfigWithApiKey,
} from "../session-helpers";
import { DEFAULT_SETTINGS } from "../settings-normalizer";
import {
	BUILTIN_AGENT_INSTALLS,
	DOCS_AGENT_SETUP_BASE,
	docsSetupUrl,
} from "../agent-packages";
import { DEFAULT_AGENT_PRIORITY } from "../agent-detection";
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
	opencode: {
		id: "opencode-acp",
		displayName: "OpenCode",
		command: "opencode",
		args: ["acp"],
		env: [],
	},
	customAgents: [],
} as unknown as AgentClientPluginSettings;

describe("OpenCode built-in agent", () => {
	it("is enumerated as an available agent after Kiro", () => {
		const ids = getAvailableAgentsFromSettings(settings).map((a) => a.id);
		expect(ids).toEqual([
			"claude-code-acp",
			"codex-acp",
			"gemini-cli",
			"kiro-cli",
			"opencode-acp",
		]);
	});

	it("resolves via findAgentSettings and launches `opencode acp`", () => {
		const found = findAgentSettings(settings, "opencode-acp");
		expect(found).toBe(settings.opencode);
		expect(found?.command).toBe("opencode");
		expect(found?.args).toEqual(["acp"]);
	});

	it("builds an agent config with NO api key (model backend lives in OpenCode)", () => {
		const cfg = buildAgentConfigWithApiKey(
			settings,
			settings.opencode,
			"opencode-acp",
			"/tmp/x",
		);
		expect(cfg).not.toHaveProperty("apiKey");
		expect(cfg.command).toBe("opencode");
		expect(cfg.args).toEqual(["acp"]);
	});

	it("ships in DEFAULT_SETTINGS as a link-only built-in", () => {
		expect(DEFAULT_SETTINGS.opencode.id).toBe("opencode-acp");
		expect(DEFAULT_SETTINGS.opencode.command).toBe("opencode");
		expect(DEFAULT_SETTINGS.opencode.args).toEqual(["acp"]);
	});

	it("is a link-only install entry (no npm package) with an opencode docs slug", () => {
		const entry = BUILTIN_AGENT_INSTALLS.find(
			(a) => a.id === "opencode-acp",
		);
		expect(entry).toBeDefined();
		expect(entry?.npmPackage).toBeNull();
		expect(entry?.docsSlug).toBe("opencode");
		expect(docsSetupUrl(entry!.docsSlug)).toBe(
			`${DOCS_AGENT_SETUP_BASE}/opencode`,
		);
	});

	it("is the lowest-priority fresh-install default (kiro still leads)", () => {
		expect(DEFAULT_AGENT_PRIORITY).toContain("opencode-acp");
		expect(DEFAULT_AGENT_PRIORITY.indexOf("opencode-acp")).toBe(
			DEFAULT_AGENT_PRIORITY.length - 1,
		);
	});

	it("does not clash with the bare `opencode` id a user's custom agent might hold", () => {
		expect(DEFAULT_SETTINGS.opencode.id).not.toBe("opencode");
	});
});
