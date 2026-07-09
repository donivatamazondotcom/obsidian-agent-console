/**
 * Regression guard for the "Default agent" settings dropdown enumeration.
 *
 * The dropdown once built its own hardcoded built-in list (claude/codex/
 * gemini/kiro), parallel to getAvailableAgentsFromSettings — so when OpenCode
 * was added as a built-in it appeared in the header picker but NOT in the
 * Default-agent dropdown (found in smoke). agentOptionsFromSettings now routes
 * through the single enumeration source; these tests lock that so the two
 * lists can't drift again.
 */

import { describe, it, expect } from "vitest";
import { agentOptionsFromSettings } from "../session-helpers";
import type { AgentClientPluginSettings } from "../../plugin";

const base = {
	claude: { id: "claude-code-acp", displayName: "Claude Code" },
	codex: { id: "codex-acp", displayName: "Codex" },
	gemini: { id: "gemini-cli", displayName: "Gemini CLI" },
	kiro: { id: "kiro-cli", displayName: "Kiro CLI" },
	opencode: { id: "opencode-acp", displayName: "OpenCode" },
	customAgents: [],
} as unknown as AgentClientPluginSettings;

describe("agentOptionsFromSettings (Default-agent dropdown)", () => {
	it("includes OpenCode among the built-in options", () => {
		const ids = agentOptionsFromSettings(base).map((o) => o.id);
		expect(ids).toContain("opencode-acp");
		expect(ids).toEqual([
			"claude-code-acp",
			"codex-acp",
			"gemini-cli",
			"kiro-cli",
			"opencode-acp",
		]);
	});

	it("labels each option as '<Display Name> (<id>)'", () => {
		const byId = new Map(
			agentOptionsFromSettings(base).map((o) => [o.id, o.label]),
		);
		expect(byId.get("opencode-acp")).toBe("OpenCode (opencode-acp)");
		expect(byId.get("kiro-cli")).toBe("Kiro CLI (kiro-cli)");
	});

	it("appends custom agents after the built-ins", () => {
		const settings = {
			...base,
			customAgents: [{ id: "qwen-code", displayName: "Qwen Code" }],
		} as unknown as AgentClientPluginSettings;
		const ids = agentOptionsFromSettings(settings).map((o) => o.id);
		expect(ids[ids.length - 1]).toBe("qwen-code");
	});

	it("dedups by id when a custom agent collides with a built-in", () => {
		const settings = {
			...base,
			customAgents: [{ id: "opencode-acp", displayName: "My OpenCode" }],
		} as unknown as AgentClientPluginSettings;
		const opencodeOptions = agentOptionsFromSettings(settings).filter(
			(o) => o.id === "opencode-acp",
		);
		expect(opencodeOptions).toHaveLength(1);
		// First occurrence (the built-in) wins.
		expect(opencodeOptions[0].label).toBe("OpenCode (opencode-acp)");
	});
});
