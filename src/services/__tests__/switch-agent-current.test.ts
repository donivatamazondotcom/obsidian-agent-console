/**
 * Reproduce-first guard for I105: "Switch-agent menu shows two agents checked".
 *
 * Root cause: the switch-agent menu marked EVERY entry whose
 * `id === session.agentId` as checked. When a custom agent's id collides with a
 * built-in id (e.g. a custom "Kiro" left over from before Kiro CLI became a
 * built-in), two entries share that id and both rows get a checkmark.
 *
 * Fix: keep all configured agents visible (do NOT drop the colliding custom
 * agent — that hid a user-configured agent, regression caught in smoke test),
 * and mark AT MOST ONE row via indexOfCurrentAgent (first id-match wins).
 */

import { describe, it, expect } from "vitest";
import {
	getAvailableAgentsFromSettings,
	indexOfCurrentAgent,
	type AgentDisplayInfo,
} from "../session-helpers";
import type { AgentClientPluginSettings } from "../../plugin";

const baseBuiltins = {
	claude: { id: "claude-code-acp", displayName: "Claude Code" },
	codex: { id: "codex-acp", displayName: "Codex" },
	gemini: { id: "gemini-cli", displayName: "Gemini CLI" },
	kiro: { id: "kiro-cli", displayName: "Kiro CLI" },
	opencode: { id: "opencode-acp", displayName: "OpenCode" },
};

describe("I105: configured agents stay visible (no dedup)", () => {
	it("keeps a custom agent whose id collides with a built-in", () => {
		const settings = {
			...baseBuiltins,
			customAgents: [
				{ id: "kiro-cli", displayName: "Kiro", command: "kiro-cli" },
			],
		} as unknown as AgentClientPluginSettings;

		const agents = getAvailableAgentsFromSettings(settings);
		// All present — the colliding custom "Kiro" is NOT dropped.
		expect(agents.map((a) => a.displayName)).toEqual([
			"Claude Code",
			"Codex",
			"Gemini CLI",
			"Kiro CLI",
			"OpenCode",
			"Kiro",
		]);
		expect(agents.filter((a) => a.id === "kiro-cli")).toHaveLength(2);
	});

	it("keeps a distinct custom agent", () => {
		const settings = {
			...baseBuiltins,
			customAgents: [
				{ id: "custom-agent", displayName: "Custom Agent", command: "kiro-cli" },
			],
		} as unknown as AgentClientPluginSettings;

		expect(
			getAvailableAgentsFromSettings(settings).map((a) => a.id),
		).toEqual([
			"claude-code-acp",
			"codex-acp",
			"gemini-cli",
			"kiro-cli",
			"opencode-acp",
			"custom-agent",
		]);
	});
});

describe("I105: indexOfCurrentAgent marks at most one row", () => {
	const agents: AgentDisplayInfo[] = [
		{ id: "claude-code-acp", displayName: "Claude Code" },
		{ id: "kiro-cli", displayName: "Kiro CLI" },
		{ id: "kiro-cli", displayName: "Kiro" }, // colliding duplicate
	];

	it("returns the FIRST matching index when ids collide (one check, not two)", () => {
		expect(indexOfCurrentAgent(agents, "kiro-cli")).toBe(1);
		// Exactly one index matches the predicate idx === currentIdx.
		const checked = agents.filter(
			(_, idx) => idx === indexOfCurrentAgent(agents, "kiro-cli"),
		);
		expect(checked).toHaveLength(1);
		expect(checked[0].displayName).toBe("Kiro CLI");
	});

	it("returns -1 (nothing checked) for no match", () => {
		expect(indexOfCurrentAgent(agents, "nope")).toBe(-1);
	});

	it("returns -1 for null/empty agentId", () => {
		expect(indexOfCurrentAgent(agents, null)).toBe(-1);
		expect(indexOfCurrentAgent(agents, "")).toBe(-1);
		expect(indexOfCurrentAgent(agents, undefined)).toBe(-1);
	});
});
