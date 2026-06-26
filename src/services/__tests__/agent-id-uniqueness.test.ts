/**
 * I105 prevention: a custom agent must not be saved with an id that collides a
 * built-in id (findAgentSettings would shadow it, making it unreachable) or
 * another custom agent's id. These cover the pure helpers behind the
 * settings-field blur enforcement.
 */

import { describe, it, expect } from "vitest";
import {
	collectAgentIdsExcept,
	resolveUniqueAgentId,
} from "../session-helpers";
import type { AgentClientPluginSettings } from "../../plugin";

const settings = {
	claude: { id: "claude-code-acp", displayName: "Claude Code" },
	codex: { id: "codex-acp", displayName: "Codex" },
	gemini: { id: "gemini-cli", displayName: "Gemini CLI" },
	kiro: { id: "kiro-cli", displayName: "Kiro CLI" },
	customAgents: [
		{ id: "custom-agent", displayName: "Custom agent" },
		{ id: "custom-agent-2", displayName: "Custom agent 2" },
	],
} as unknown as AgentClientPluginSettings;

describe("collectAgentIdsExcept", () => {
	it("includes built-ins and other customs, excluding the edited index", () => {
		expect(collectAgentIdsExcept(settings, 0)).toEqual([
			"claude-code-acp",
			"codex-acp",
			"gemini-cli",
			"kiro-cli",
			"custom-agent-2",
		]);
	});

	it("excludes none with index -1", () => {
		expect(collectAgentIdsExcept(settings, -1)).toContain("custom-agent");
		expect(collectAgentIdsExcept(settings, -1)).toContain("custom-agent-2");
	});
});

describe("resolveUniqueAgentId", () => {
	it("returns the candidate unchanged when free", () => {
		expect(resolveUniqueAgentId("kiro-c", ["kiro-cli"])).toBe("kiro-c");
	});

	it("suffixes a collision with a built-in id", () => {
		const taken = collectAgentIdsExcept(settings, 0);
		expect(resolveUniqueAgentId("kiro-cli", taken)).toBe("kiro-cli-2");
	});

	it("suffixes a collision with another custom agent id", () => {
		const taken = collectAgentIdsExcept(settings, 0);
		expect(resolveUniqueAgentId("custom-agent-2", taken)).toBe(
			"custom-agent-2-2",
		);
	});

	it("increments the suffix until unique", () => {
		expect(
			resolveUniqueAgentId("x", ["x", "x-2", "x-3"]),
		).toBe("x-4");
	});

	it("does not flag the agent's own current id (excluded from taken set)", () => {
		// Editing custom-agent (index 0) and keeping its own id is a no-op:
		// its id is excluded from the taken set, so it stays free.
		const taken = collectAgentIdsExcept(settings, 0);
		expect(resolveUniqueAgentId("custom-agent", taken)).toBe(
			"custom-agent",
		);
	});
});
