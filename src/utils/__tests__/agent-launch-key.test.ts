/** I260 — the capability cache's launch key. */
import { describe, it, expect } from "vitest";
import { agentLaunchKey } from "../agent-launch-key";

describe("agentLaunchKey", () => {
	it("separates the Kiro engines for one command", () => {
		expect(agentLaunchKey({ command: "kiro-cli", kiroEngine: "v3" })).not.toBe(
			agentLaunchKey({ command: "kiro-cli", kiroEngine: "v2" }),
		);
	});
	it("treats a missing engine as v2 (no Kiro rewrite)", () => {
		expect(agentLaunchKey({ command: "claude-agent-acp" })).toBe(
			agentLaunchKey({ command: "claude-agent-acp", kiroEngine: "v2" }),
		);
	});
	it("separates commands and ignores surrounding whitespace", () => {
		expect(agentLaunchKey({ command: " codex-acp " })).toBe(
			agentLaunchKey({ command: "codex-acp" }),
		);
		expect(agentLaunchKey({ command: "codex-acp" })).not.toBe(
			agentLaunchKey({ command: "claude-agent-acp" }),
		);
	});
});
