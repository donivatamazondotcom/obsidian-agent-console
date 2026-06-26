import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
	decideSessionIntent,
	type SessionIntent,
	type SessionIntentDecision,
} from "../agent-switch";

/**
 * Exhaustive transition + property tests for `decideSessionIntent` — the
 * unified pure decision behind "useLazySession is the sole owner of
 * session/new" ([[Tab Agent Identity and Session Acquisition Unification]]
 * design item #1). These tests are the regression guard the retro prescribed
 * (pure reducer + exhaustive transitions) BEFORE any handler is rewired, so
 * the switch-then-send / new-chat-with-session classes are settled by the
 * decision layer, not discovered by manual reload.
 */

const CUR = "test-agent";
const OTHER = "claude-code";

describe("decideSessionIntent — switch-agent", () => {
	it("same agent → noop", () => {
		expect(
			decideSessionIntent({
				intent: "switch-agent",
				currentAgentId: CUR,
				requestedAgentId: CUR,
				hasSession: false,
				messageCount: 0,
			}),
		).toEqual({ kind: "noop" });
	});

	it("different agent, idle+empty → swap-idle (no eager session) — the wrong-agent bug", () => {
		expect(
			decideSessionIntent({
				intent: "switch-agent",
				currentAgentId: CUR,
				requestedAgentId: OTHER,
				hasSession: false,
				messageCount: 0,
			}),
		).toEqual({ kind: "swap-idle", agentId: OTHER });
	});

	it("different agent, has session → recreate-lazy (teardown + reset + defer)", () => {
		expect(
			decideSessionIntent({
				intent: "switch-agent",
				currentAgentId: CUR,
				requestedAgentId: OTHER,
				hasSession: true,
				messageCount: 5,
			}),
		).toEqual({ kind: "recreate-lazy", agentId: OTHER });
	});

	it("different agent, messages but no session → recreate-lazy", () => {
		expect(
			decideSessionIntent({
				intent: "switch-agent",
				currentAgentId: CUR,
				requestedAgentId: OTHER,
				hasSession: false,
				messageCount: 2,
			}),
		).toEqual({ kind: "recreate-lazy", agentId: OTHER });
	});
});

describe("decideSessionIntent — new-chat", () => {
	it("same agent, already empty+idle → noop ('Already a new session')", () => {
		expect(
			decideSessionIntent({
				intent: "new-chat",
				currentAgentId: CUR,
				hasSession: false,
				messageCount: 0,
			}),
		).toEqual({ kind: "noop" });
	});

	it("same agent, has messages → recreate-lazy (clear + reset + defer)", () => {
		expect(
			decideSessionIntent({
				intent: "new-chat",
				currentAgentId: CUR,
				hasSession: true,
				messageCount: 4,
			}),
		).toEqual({ kind: "recreate-lazy", agentId: CUR });
	});

	it("new-chat carrying a different agent behaves like a switch (idle+empty → swap-idle)", () => {
		expect(
			decideSessionIntent({
				intent: "new-chat",
				currentAgentId: CUR,
				requestedAgentId: OTHER,
				hasSession: false,
				messageCount: 0,
			}),
		).toEqual({ kind: "swap-idle", agentId: OTHER });
	});
});

describe("decideSessionIntent — new-chat-in-directory", () => {
	it("always recreate-lazy on the current agent (caller sets the cwd)", () => {
		for (const [hasSession, messageCount] of [
			[false, 0],
			[true, 3],
			[false, 2],
		] as const) {
			expect(
				decideSessionIntent({
					intent: "new-chat-in-directory",
					currentAgentId: CUR,
					hasSession,
					messageCount,
				}),
			).toEqual({ kind: "recreate-lazy", agentId: CUR });
		}
	});
});

describe("decideSessionIntent — restart-agent / hard-reload", () => {
	for (const intent of ["restart-agent", "hard-reload"] as const) {
		it(`${intent} → respawn-lazy on the current agent (disconnect + reset + defer)`, () => {
			expect(
				decideSessionIntent({
					intent,
					currentAgentId: CUR,
					hasSession: true,
					messageCount: 7,
				}),
			).toEqual({ kind: "respawn-lazy", agentId: CUR });
		});

		it(`${intent} on an idle no-session tab still respawn-lazy (disconnect is a safe no-op)`, () => {
			expect(
				decideSessionIntent({
					intent,
					currentAgentId: CUR,
					hasSession: false,
					messageCount: 0,
				}),
			).toEqual({ kind: "respawn-lazy", agentId: CUR });
		});
	}
});

describe("decideSessionIntent — soft-reload", () => {
	it("with a live session → resume (loadSession, not session/new)", () => {
		expect(
			decideSessionIntent({
				intent: "soft-reload",
				currentAgentId: CUR,
				hasSession: true,
				messageCount: 3,
			}),
		).toEqual({ kind: "resume" });
	});

	it("with no live session → noop (nothing to resume)", () => {
		expect(
			decideSessionIntent({
				intent: "soft-reload",
				currentAgentId: CUR,
				hasSession: false,
				messageCount: 0,
			}),
		).toEqual({ kind: "noop" });
	});
});

// ============================================================================
// Property tests (fast-check) — the model-based harness foundation. These
// assert structural invariants across the ENTIRE intent × state space, so a
// future change to one branch can't silently break another (the cascading-bug
// failure mode the retro measured).
// ============================================================================

const intentArb: fc.Arbitrary<SessionIntent> = fc.constantFrom(
	"switch-agent",
	"new-chat",
	"new-chat-in-directory",
	"restart-agent",
	"hard-reload",
	"soft-reload",
);

const paramsArb = fc.record({
	intent: intentArb,
	currentAgentId: fc.constantFrom("test-agent", "claude-code", "codex"),
	requestedAgentId: fc.option(
		fc.constantFrom("test-agent", "claude-code", "codex"),
		{ nil: undefined },
	),
	hasSession: fc.boolean(),
	messageCount: fc.nat({ max: 50 }),
});

const KNOWN_KINDS: ReadonlyArray<SessionIntentDecision["kind"]> = [
	"noop",
	"swap-idle",
	"recreate-lazy",
	"respawn-lazy",
	"resume",
];

describe("decideSessionIntent — properties", () => {
	it("is total: every input maps to a known kind and never throws", () => {
		fc.assert(
			fc.property(paramsArb, (params) => {
				const d = decideSessionIntent(params);
				expect(KNOWN_KINDS).toContain(d.kind);
			}),
		);
	});

	it("every acquiring decision binds the next acquisition to the resolved target agent", () => {
		fc.assert(
			fc.property(paramsArb, (params) => {
				const d = decideSessionIntent(params);
				if (
					d.kind === "swap-idle" ||
					d.kind === "recreate-lazy" ||
					d.kind === "respawn-lazy"
				) {
					const target =
						params.requestedAgentId || params.currentAgentId;
					expect(d.agentId).toBe(target);
				}
			}),
		);
	});

	it("swap-idle ONLY when switching agent on an idle, empty tab (laziness preserved)", () => {
		fc.assert(
			fc.property(paramsArb, (params) => {
				const d = decideSessionIntent(params);
				if (d.kind === "swap-idle") {
					const target =
						params.requestedAgentId || params.currentAgentId;
					expect(target).not.toBe(params.currentAgentId);
					expect(params.hasSession).toBe(false);
					expect(params.messageCount).toBe(0);
					expect(
						params.intent === "switch-agent" ||
							params.intent === "new-chat",
					).toBe(true);
				}
			}),
		);
	});

	it("resume ONLY for soft-reload with a live session; restart/hard-reload always respawn", () => {
		fc.assert(
			fc.property(paramsArb, (params) => {
				const d = decideSessionIntent(params);
				if (d.kind === "resume") {
					expect(params.intent).toBe("soft-reload");
					expect(params.hasSession).toBe(true);
				}
				if (
					params.intent === "restart-agent" ||
					params.intent === "hard-reload"
				) {
					expect(d.kind).toBe("respawn-lazy");
				}
			}),
		);
	});

	it("a same-agent switch is never an eager session create (noop or recreate-lazy only)", () => {
		fc.assert(
			fc.property(paramsArb, (params) => {
				const sameAgent =
					!params.requestedAgentId ||
					params.requestedAgentId === params.currentAgentId;
				if (params.intent === "switch-agent" && sameAgent) {
					// Never an eager create: empty idle → noop, otherwise the
					// lazy recreate path (clear + reset + defer), never swap to
					// a different agent and never a respawn.
					expect(["noop", "recreate-lazy"]).toContain(
						decideSessionIntent(params).kind,
					);
				}
			}),
		);
	});
});
