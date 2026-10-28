import { describe, it, expect } from "vitest";
import { resolvePromptTarget, resolvePromptMode } from "../prompt-target";

/**
 * Quick prompt `agent:` / `mode:` frontmatter → where and how a fire lands.
 * See [[Agent Console Quick Prompt Agent and Mode]] T01–T04, T06.
 */

const AGENTS = ["claude-code", "kiro-cli", "codex"];

describe("resolvePromptTarget", () => {
	// T01
	it("opens a new tab with the declared agent when it differs from the active tab", () => {
		expect(
			resolvePromptTarget(
				{ agent: "kiro-cli" },
				{ activeAgentId: "claude-code", availableAgentIds: AGENTS },
			),
		).toEqual({ kind: "new-tab", agentId: "kiro-cli" });
	});

	// T01: a different agent implies newTab even when newTab is explicitly false
	it("never switches the current tab's agent, even with newTab: false", () => {
		expect(
			resolvePromptTarget(
				{ agent: "codex", newTab: false },
				{ activeAgentId: "claude-code", availableAgentIds: AGENTS },
			).kind,
		).toBe("new-tab");
	});

	// T02
	it("fires here when the agent matches and newTab is unset", () => {
		expect(
			resolvePromptTarget(
				{ agent: "claude-code" },
				{ activeAgentId: "claude-code", availableAgentIds: AGENTS },
			),
		).toEqual({ kind: "here" });
	});

	it("fires here when no agent is declared and newTab is unset", () => {
		expect(
			resolvePromptTarget(
				{},
				{ activeAgentId: "claude-code", availableAgentIds: AGENTS },
			),
		).toEqual({ kind: "here" });
	});

	it("leaves the agent to the caller's default when newTab is true and no agent is declared", () => {
		// Shipped newTab behavior opens the default agent, not the active one.
		expect(
			resolvePromptTarget(
				{ newTab: true },
				{ activeAgentId: "kiro-cli", availableAgentIds: AGENTS },
			),
		).toEqual({ kind: "new-tab" });
	});

	it("opens a new tab with no agent id when nothing is active and none is declared", () => {
		expect(
			resolvePromptTarget(
				{ newTab: true },
				{ activeAgentId: null, availableAgentIds: AGENTS },
			),
		).toEqual({ kind: "new-tab" });
	});

	it("opens a new tab with the declared agent when no tab is active", () => {
		expect(
			resolvePromptTarget(
				{ agent: "codex" },
				{ activeAgentId: null, availableAgentIds: AGENTS },
			),
		).toEqual({ kind: "new-tab", agentId: "codex" });
	});

	// T03
	it("returns unknown-agent for an id not in settings, regardless of newTab", () => {
		for (const newTab of [undefined, true, false]) {
			expect(
				resolvePromptTarget(
					{ agent: "gemnii", newTab },
					{ activeAgentId: "claude-code", availableAgentIds: AGENTS },
				),
			).toEqual({ kind: "unknown-agent", agentId: "gemnii" });
		}
	});

	it("matches agent ids exactly — no case folding or guessing", () => {
		expect(
			resolvePromptTarget(
				{ agent: "Claude-Code" },
				{ activeAgentId: "claude-code", availableAgentIds: AGENTS },
			).kind,
		).toBe("unknown-agent");
	});

	// T04
	it("carries the mode on both here and new-tab results", () => {
		expect(
			resolvePromptTarget(
				{ mode: "plan" },
				{ activeAgentId: "claude-code", availableAgentIds: AGENTS },
			),
		).toEqual({ kind: "here", modeId: "plan" });
		expect(
			resolvePromptTarget(
				{ agent: "kiro-cli", mode: "plan" },
				{ activeAgentId: "claude-code", availableAgentIds: AGENTS },
			),
		).toEqual({ kind: "new-tab", agentId: "kiro-cli", modeId: "plan" });
	});
});

describe("resolvePromptMode", () => {
	const MODES = [{ id: "default" }, { id: "plan" }];

	it("is a no-op when no mode is requested", () => {
		expect(resolvePromptMode(undefined, MODES, "default")).toEqual({
			kind: "none",
		});
	});

	it("is a no-op when the session is already in the requested mode", () => {
		expect(resolvePromptMode("plan", MODES, "plan")).toEqual({
			kind: "none",
		});
	});

	it("asks for a switch when the mode exists and differs", () => {
		expect(resolvePromptMode("plan", MODES, "default")).toEqual({
			kind: "switch",
			modeId: "plan",
		});
	});

	// T06 (pure half): unknown mode → stage, don't send
	it("returns unknown-mode when the session does not advertise it", () => {
		expect(resolvePromptMode("yolo", MODES, "default")).toEqual({
			kind: "unknown-mode",
			modeId: "yolo",
		});
	});

	it("returns unknown-mode when the session advertises no modes at all", () => {
		expect(resolvePromptMode("plan", [], "")).toEqual({
			kind: "unknown-mode",
			modeId: "plan",
		});
	});
});
