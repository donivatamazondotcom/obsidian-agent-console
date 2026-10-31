import { describe, it, expect } from "vitest";
import { resolvePromptTarget, type PromptTargetContext } from "../prompt-target";

/**
 * The rule: a different agent or mode than the current tab → new tab set up
 * that way; otherwise fire in place. `agent:` / `mode:` accept an id or the
 * display name the user sees. See
 * [[Agent Console Quick Prompt Agent and Mode]] T01–T04, T05b.
 */

const AGENTS = [
	{ id: "claude-code", name: "Claude Code" },
	{ id: "kiro-cli", name: "Kiro CLI" },
	{ id: "codex", name: "Codex" },
];
const CLAUDE_MODES = [
	{ id: "default", name: "Default" },
	{ id: "plan", name: "Plan Mode" },
];

function inClaude(currentModeId: string | null = "default"): PromptTargetContext {
	return {
		activeAgentId: "claude-code",
		activeModes:
			currentModeId === null
				? null
				: {
						current: CLAUDE_MODES.find((m) => m.id === currentModeId) ?? {
							id: currentModeId,
							name: currentModeId,
						},
						offered: CLAUDE_MODES,
					},
		agents: AGENTS,
	};
}
const NONE: PromptTargetContext = {
	activeAgentId: null,
	activeModes: null,
	agents: AGENTS,
};

describe("resolvePromptTarget — agent", () => {
	// T01
	it("opens a new tab with the declared agent when it differs", () => {
		expect(resolvePromptTarget({ agent: "kiro-cli" }, inClaude())).toEqual({
			kind: "new-tab",
			agentId: "kiro-cli",
		});
	});

	it("never switches the current tab's agent, even with newTab: false", () => {
		expect(
			resolvePromptTarget({ agent: "codex", newTab: false }, inClaude()),
		).toEqual({ kind: "new-tab", agentId: "codex" });
	});

	// T05b
	it("accepts the agent's display name and resolves it to the id", () => {
		expect(resolvePromptTarget({ agent: "Kiro CLI" }, inClaude())).toEqual({
			kind: "new-tab",
			agentId: "kiro-cli",
		});
		expect(resolvePromptTarget({ agent: "claude code" }, inClaude())).toEqual(
			{ kind: "here" },
		);
	});

	// T04
	it("returns unknown-agent for no match, regardless of newTab", () => {
		for (const newTab of [undefined, true, false]) {
			expect(
				resolvePromptTarget({ agent: "test-unconfigured", newTab }, inClaude()),
			).toEqual({ kind: "unknown-agent", agentId: "test-unconfigured" });
		}
	});

	it("returns unknown-agent for an ambiguous display name", () => {
		const ctx = {
			...inClaude(),
			agents: [...AGENTS, { id: "test-agent", name: "claude code" }],
		};
		expect(resolvePromptTarget({ agent: "CLAUDE CODE" }, ctx).kind).toBe(
			"unknown-agent",
		);
	});
});

describe("resolvePromptTarget — mode", () => {
	// T02
	it("opens a new tab on the current agent when only the mode differs", () => {
		expect(resolvePromptTarget({ mode: "plan" }, inClaude())).toEqual({
			kind: "new-tab",
			agentId: "claude-code",
			modeId: "plan",
		});
	});

	it("resolves a mode display name to its id on the current agent", () => {
		expect(resolvePromptTarget({ mode: "Plan Mode" }, inClaude())).toEqual({
			kind: "new-tab",
			agentId: "claude-code",
			modeId: "plan",
		});
	});

	it("fires here when the mode name matches the current mode", () => {
		expect(resolvePromptTarget({ mode: "plan mode" }, inClaude("plan"))).toEqual(
			{ kind: "here" },
		);
	});

	it("fails early with unknown-mode when the current agent doesn't offer it", () => {
		expect(resolvePromptTarget({ mode: "yolo" }, inClaude())).toEqual({
			kind: "unknown-mode",
			agentId: "claude-code",
			modeId: "yolo",
		});
	});

	it("treats unknown current modes as different and passes the request on raw", () => {
		expect(resolvePromptTarget({ mode: "plan" }, inClaude(null))).toEqual({
			kind: "new-tab",
			agentId: "claude-code",
			modeId: "plan",
		});
	});

	it("passes the mode on raw for a different agent (resolved when its session starts)", () => {
		expect(
			resolvePromptTarget({ agent: "Kiro CLI", mode: "Default" }, inClaude()),
		).toEqual({ kind: "new-tab", agentId: "kiro-cli", modeId: "Default" });
	});

	// T03
	it("fires here when agent and mode both match", () => {
		expect(
			resolvePromptTarget({ agent: "claude-code", mode: "plan" }, inClaude("plan")),
		).toEqual({ kind: "here" });
	});

	it("fires here when neither agent nor mode is declared", () => {
		expect(resolvePromptTarget({}, inClaude())).toEqual({ kind: "here" });
	});

	it("keeps shipped newTab behavior: default agent when no agent is declared", () => {
		expect(resolvePromptTarget({ newTab: true }, inClaude())).toEqual({
			kind: "new-tab",
		});
	});

	it("opens a new tab for everything when no tab is open", () => {
		expect(resolvePromptTarget({}, NONE)).toEqual({ kind: "new-tab" });
		expect(
			resolvePromptTarget({ agent: "codex", mode: "plan" }, NONE),
		).toEqual({ kind: "new-tab", agentId: "codex", modeId: "plan" });
	});
});
