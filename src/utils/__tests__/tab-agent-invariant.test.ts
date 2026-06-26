import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
	checkTabAgentInvariant,
	assertTabAgentInvariant,
} from "../tab-agent-invariant";

/**
 * Tests for the governing runtime invariant: a tab's LIVE session agent ==
 * the tab's SELECTED agent ([[Tab Agent Identity and Session Acquisition
 * Unification]] design item #3). Fails loud at the offending write; vacuously
 * satisfied when there is no live session.
 */
describe("checkTabAgentInvariant", () => {
	it("holds when live session agent matches the selected agent", () => {
		expect(
			checkTabAgentInvariant({
				selectedAgentId: "claude-code",
				liveSessionAgentId: "claude-code",
			}),
		).toBeNull();
	});

	it("violates when the live session is bound to a different agent — the wrong-agent bug", () => {
		const v = checkTabAgentInvariant({
			selectedAgentId: "claude-code",
			liveSessionAgentId: "test-agent",
		});
		expect(v).not.toBeNull();
		expect(v?.code).toBe("tab-agent-mismatch");
		expect(v?.selectedAgentId).toBe("claude-code");
		expect(v?.liveSessionAgentId).toBe("test-agent");
		// Message names both sides so logs/metrics are self-explaining.
		expect(v?.message).toContain("claude-code");
		expect(v?.message).toContain("test-agent");
	});

	it("vacuously holds when there is no live session (idle/lazy tab)", () => {
		expect(
			checkTabAgentInvariant({
				selectedAgentId: "claude-code",
				liveSessionAgentId: null,
			}),
		).toBeNull();
		expect(
			checkTabAgentInvariant({
				selectedAgentId: "claude-code",
				liveSessionAgentId: undefined,
			}),
		).toBeNull();
	});

	it("does not assert a match when no agent is selected (degenerate state)", () => {
		expect(
			checkTabAgentInvariant({
				selectedAgentId: null,
				liveSessionAgentId: "test-agent",
			}),
		).toBeNull();
	});
});

describe("assertTabAgentInvariant", () => {
	it("throws on a mismatch (fail-loud, never coerce)", () => {
		expect(() =>
			assertTabAgentInvariant({
				selectedAgentId: "claude-code",
				liveSessionAgentId: "test-agent",
			}),
		).toThrow(/invariant violated/i);
	});

	it("does not throw when the invariant holds", () => {
		expect(() =>
			assertTabAgentInvariant({
				selectedAgentId: "claude-code",
				liveSessionAgentId: "claude-code",
			}),
		).not.toThrow();
		expect(() =>
			assertTabAgentInvariant({
				selectedAgentId: "claude-code",
				liveSessionAgentId: null,
			}),
		).not.toThrow();
	});
});

describe("tab-agent invariant — properties", () => {
	const agentArb = fc.constantFrom("test-agent", "claude-code", "codex");

	it("violation iff both ids are present AND differ", () => {
		fc.assert(
			fc.property(
				fc.option(agentArb, { nil: null }),
				fc.option(agentArb, { nil: null }),
				(selectedAgentId, liveSessionAgentId) => {
					const v = checkTabAgentInvariant({
						selectedAgentId,
						liveSessionAgentId,
					});
					const shouldViolate =
						!!selectedAgentId &&
						!!liveSessionAgentId &&
						selectedAgentId !== liveSessionAgentId;
					expect(v !== null).toBe(shouldViolate);
				},
			),
		);
	});

	it("assert and check agree for all inputs", () => {
		fc.assert(
			fc.property(
				fc.option(agentArb, { nil: null }),
				fc.option(agentArb, { nil: null }),
				(selectedAgentId, liveSessionAgentId) => {
					const input = { selectedAgentId, liveSessionAgentId };
					const violated = checkTabAgentInvariant(input) !== null;
					let threw = false;
					try {
						assertTabAgentInvariant(input);
					} catch {
						threw = true;
					}
					expect(threw).toBe(violated);
				},
			),
		);
	});
});
