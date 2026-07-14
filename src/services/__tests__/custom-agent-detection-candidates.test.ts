/**
 * Regression guard for I171: custom agents absent from the landing
 * "New chat with an agent" picker.
 *
 * Root cause: `probeInstalledAgents` (plugin.ts) built its OWN hardcoded
 * built-in candidate list (claude/codex/gemini/kiro/opencode) and never
 * probed `settings.customAgents`. The landing picker (deriveAgentPickerOptions)
 * gates to DETECTED agents, so a custom agent — never a detection candidate —
 * was always filtered out even though it was configured with a resolvable
 * command. Same class as I167 (a second hardcoded built-in list drifting from
 * the single enumeration source).
 *
 * Fix: buildAgentDetectionCandidates routes through the single enumeration
 * source (getAvailableAgentsFromSettings), so detection candidates and the
 * picker's available list can never drift.
 */

import { describe, it, expect } from "vitest";
import {
	buildAgentDetectionCandidates,
	getAvailableAgentsFromSettings,
} from "../session-helpers";
import { detectAvailableAgents } from "../agent-detection";
import { deriveAgentPickerOptions } from "../../resolvers/agent-picker-options";
import type { AgentClientPluginSettings } from "../../plugin";

const base = {
	claude: { id: "claude-code-acp", displayName: "Claude Code", command: "claude-agent-acp" },
	codex: { id: "codex-acp", displayName: "Codex", command: "codex-acp" },
	gemini: { id: "gemini-cli", displayName: "Gemini CLI", command: "gemini" },
	kiro: { id: "kiro-cli", displayName: "Kiro CLI", command: "kiro-cli" },
	opencode: { id: "opencode-acp", displayName: "OpenCode", command: "opencode" },
	defaultAgentId: "kiro-cli",
	customAgents: [] as Array<{ id: string; displayName: string; command: string }>,
} as unknown as AgentClientPluginSettings;

const withCustom = {
	...base,
	customAgents: [
		{ id: "my-custom-agent", displayName: "My Custom Agent", command: "/Users/x/bin/my-custom-cli" },
	],
} as unknown as AgentClientPluginSettings;

describe("I171: buildAgentDetectionCandidates covers every configured agent", () => {
	it("includes a candidate (id + command) for the custom agent", () => {
		const candidates = buildAgentDetectionCandidates(withCustom);
		const custom = candidates.find((c) => c.id === "my-custom-agent");
		expect(custom).toBeDefined();
		expect(custom?.command).toBe("/Users/x/bin/my-custom-cli");
	});

	it("covers every id in the single enumeration source (no drift)", () => {
		const availableIds = getAvailableAgentsFromSettings(withCustom).map((a) => a.id);
		const candidateIds = buildAgentDetectionCandidates(withCustom).map((c) => c.id);
		for (const id of availableIds) {
			expect(candidateIds).toContain(id);
		}
	});
});

describe("I171: a resolvable custom agent reaches the landing picker", () => {
	it("appears in deriveAgentPickerOptions once detection includes it", async () => {
		// Every configured command resolves (custom agent's binary exists).
		const resolve = async (command: string) => `/resolved/${command}`;
		const detected = await detectAvailableAgents(
			buildAgentDetectionCandidates(withCustom),
			resolve,
		);

		// The custom agent must now be in the detected set...
		expect(detected.has("my-custom-agent")).toBe(true);

		// ...and therefore survive the picker's detection gate.
		const picker = deriveAgentPickerOptions({
			available: getAvailableAgentsFromSettings(withCustom),
			detected,
			defaultAgentId: "kiro-cli",
		});
		const ids = picker.options.map((o) => o.id);
		expect(ids).toContain("my-custom-agent");
	});
});
