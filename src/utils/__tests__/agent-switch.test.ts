import { describe, it, expect } from "vitest";
import {
	decideAgentSwitch,
	selectAcquisitionAgent,
} from "../agent-switch";

/**
 * Reproduce-first guard for the "new tab → switch agent → first message
 * connects to the OLD agent" bug.
 *
 * Root cause (two seams):
 *  1. Switching agent on an idle, no-session tab eagerly created a session
 *     via handleNewChat→createSession, leaving the lazy state machine at
 *     `idle`. The first send then re-acquired through the lazy path.
 *  2. The lazy acquisition computed the agent as the mount-time prop
 *     (`config?.agent || initialAgentId`), ignoring the switched-to agent,
 *     so it clobbered the session back to the original (default) agent.
 *
 * These pure helpers encode the corrected decisions.
 */
describe("decideAgentSwitch", () => {
	it("idle, no-session tab + different agent → swap-idle (NOT recreate) — the bug", () => {
		// Before the fix this path ran handleNewChat→createSession (≈ recreate),
		// which desynced the lazy machine and led to the clobber on first send.
		expect(
			decideAgentSwitch({
				requestedAgentId: "claude-code",
				currentAgentId: "test-agent",
				hasSession: false,
				messageCount: 0,
			}),
		).toEqual({ kind: "swap-idle" });
	});

	it("same agent → noop", () => {
		expect(
			decideAgentSwitch({
				requestedAgentId: "test-agent",
				currentAgentId: "test-agent",
				hasSession: false,
				messageCount: 0,
			}),
		).toEqual({ kind: "noop" });
	});

	it("active session + different agent → recreate (genuine teardown)", () => {
		expect(
			decideAgentSwitch({
				requestedAgentId: "claude-code",
				currentAgentId: "test-agent",
				hasSession: true,
				messageCount: 3,
			}),
		).toEqual({ kind: "recreate" });
	});

	it("messages present but no session yet + different agent → recreate", () => {
		expect(
			decideAgentSwitch({
				requestedAgentId: "claude-code",
				currentAgentId: "test-agent",
				hasSession: false,
				messageCount: 2,
			}),
		).toEqual({ kind: "recreate" });
	});
});

describe("selectAcquisitionAgent", () => {
	it("prefers the live session agent over the mount-time fallback — the clobber fix", () => {
		// After a swap-idle, session.agentId is the switched agent; the lazy
		// path must acquire THAT, not the original mount-time prop.
		expect(selectAcquisitionAgent("claude-code", "test-agent")).toBe(
			"claude-code",
		);
	});

	it("falls back to the mount-time agent when no session agent is set", () => {
		expect(selectAcquisitionAgent(null, "test-agent")).toBe("test-agent");
		expect(selectAcquisitionAgent(undefined, "test-agent")).toBe("test-agent");
	});

	it("returns undefined when neither is available", () => {
		expect(selectAcquisitionAgent(null, undefined)).toBeUndefined();
	});
});
