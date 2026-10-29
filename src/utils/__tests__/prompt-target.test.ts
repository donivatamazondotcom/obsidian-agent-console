import { describe, it, expect } from "vitest";
import { resolvePromptTarget, sessionModeInfo } from "../prompt-target";
import type { SessionConfigOption } from "../../types/session";

/**
 * The rule: a different agent or mode than the current tab → new tab set up
 * that way; otherwise fire in place. See
 * [[Agent Console Quick Prompt Agent and Mode]] T01–T05.
 */

const AGENTS = ["claude-code", "kiro-cli", "codex"];
const inClaude = (activeModeId: string | null = "default") => ({
	activeAgentId: "claude-code",
	activeModeId,
	availableAgentIds: AGENTS,
});

describe("resolvePromptTarget", () => {
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

	it("carries the mode into a new tab opened for a different agent", () => {
		expect(
			resolvePromptTarget({ agent: "kiro-cli", mode: "plan" }, inClaude()),
		).toEqual({ kind: "new-tab", agentId: "kiro-cli", modeId: "plan" });
	});

	// T02
	it("opens a new tab on the current agent when only the mode differs", () => {
		expect(resolvePromptTarget({ mode: "plan" }, inClaude())).toEqual({
			kind: "new-tab",
			agentId: "claude-code",
			modeId: "plan",
		});
	});

	it("treats an unknown current mode as different (never assume a match)", () => {
		expect(resolvePromptTarget({ mode: "plan" }, inClaude(null)).kind).toBe(
			"new-tab",
		);
	});

	it("opens a new tab when the agent matches but the mode differs", () => {
		expect(
			resolvePromptTarget(
				{ agent: "claude-code", mode: "plan" },
				inClaude(),
			),
		).toEqual({ kind: "new-tab", agentId: "claude-code", modeId: "plan" });
	});

	// T03
	it("fires here when agent and mode both match", () => {
		expect(
			resolvePromptTarget(
				{ agent: "claude-code", mode: "plan" },
				inClaude("plan"),
			),
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
		const none = {
			activeAgentId: null,
			activeModeId: null,
			availableAgentIds: AGENTS,
		};
		expect(resolvePromptTarget({}, none)).toEqual({ kind: "new-tab" });
		expect(resolvePromptTarget({ agent: "codex", mode: "plan" }, none)).toEqual(
			{ kind: "new-tab", agentId: "codex", modeId: "plan" },
		);
	});

	// T04
	it("returns unknown-agent for an id not in settings, regardless of newTab", () => {
		for (const newTab of [undefined, true, false]) {
			expect(
				resolvePromptTarget({ agent: "gemnii", newTab }, inClaude()),
			).toEqual({ kind: "unknown-agent", agentId: "gemnii" });
		}
	});

	it("matches agent ids exactly — no case folding or guessing", () => {
		expect(
			resolvePromptTarget({ agent: "Claude-Code" }, inClaude()).kind,
		).toBe("unknown-agent");
	});
});

// T05
describe("sessionModeInfo", () => {
	const modeOption = (
		currentValue: string,
		options: SessionConfigOption["options"],
	): SessionConfigOption => ({
		id: "mode",
		name: "Mode",
		category: "mode",
		type: "select",
		currentValue,
		options,
	});

	it("reads legacy modes", () => {
		expect(
			sessionModeInfo({
				modes: {
					currentModeId: "default",
					availableModes: [
						{ id: "default", name: "Default" },
						{ id: "plan", name: "Plan" },
					],
				},
			}),
		).toEqual({ current: "default", offered: ["default", "plan"] });
	});

	it("reads the mode-category config option, including grouped options", () => {
		expect(
			sessionModeInfo({
				configOptions: [
					modeOption("plan", [
						{
							group: "g",
							name: "G",
							options: [
								{ value: "default", name: "Default" },
								{ value: "plan", name: "Plan" },
							],
						},
					]),
				],
			}),
		).toEqual({ current: "plan", offered: ["default", "plan"] });
	});

	it("prefers config options over legacy modes", () => {
		expect(
			sessionModeInfo({
				modes: {
					currentModeId: "legacy",
					availableModes: [{ id: "legacy", name: "L" }],
				},
				configOptions: [modeOption("new", [{ value: "new", name: "N" }])],
			}),
		).toEqual({ current: "new", offered: ["new"] });
	});

	it("ignores non-mode config options and reports no modes", () => {
		expect(
			sessionModeInfo({
				configOptions: [
					{
						...modeOption("m1", [{ value: "m1", name: "M1" }]),
						id: "model",
						category: "model",
					},
				],
			}),
		).toEqual({ current: null, offered: [] });
	});

	it("reports no modes when the session has none", () => {
		expect(sessionModeInfo({})).toEqual({ current: null, offered: [] });
	});
});
