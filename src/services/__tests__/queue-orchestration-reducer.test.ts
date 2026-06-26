import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
	queueOrchestrationReducer,
	initialQueueState,
	isQueued,
	type QueueEvent,
	type QueueEffect,
	type QueueOrchestrationState,
} from "../queue-orchestration-reducer";
import type { QueuedMessage } from "../../types/chat";

/**
 * Exhaustive transition + property tests for `queueOrchestrationReducer` — the
 * dispatch-owning single-slot reducer for queue-next-message (#82). These are
 * the regression guard the [[ChatPanel lifecycle harness proposal]] prescribed
 * (pure reducer + exhaustive transitions + fast-check properties) BEFORE the
 * ChatPanel effects are rewired, so the flush-vs-hold and raw-vs-wrapper
 * decisions are settled by the decision layer, not discovered by manual smoke.
 *
 * Converges with `decide-session-intent.test.ts` and `lifecycle-model.test.ts`.
 */

const MSG: QueuedMessage = { content: "hello" };
const MSG2: QueuedMessage = { content: "second" };
const FULL: QueueOrchestrationState = { pending: MSG };
const EMPTY: QueueOrchestrationState = { pending: null };

// ============================================================================
// Exhaustive transitions
// ============================================================================

describe("queueOrchestrationReducer — send events", () => {
	it("sendWhileReady → dispatch now (clear + raw flush), slot stays empty", () => {
		const r = queueOrchestrationReducer(EMPTY, {
			type: "sendWhileReady",
			message: MSG,
		});
		expect(r.state.pending).toBeNull();
		expect(r.effects).toEqual([
			{ kind: "clearComposer" },
			{ kind: "flushDispatch", message: MSG },
		]);
	});

	it("sendWhileStreaming on empty slot → hold, no acquire, no dispatch", () => {
		const r = queueOrchestrationReducer(EMPTY, {
			type: "sendWhileStreaming",
			message: MSG,
		});
		expect(r.state.pending).toBe(MSG);
		expect(r.effects).toEqual([]);
	});

	it("sendWhilePreReady on empty slot → hold + acquire", () => {
		const r = queueOrchestrationReducer(EMPTY, {
			type: "sendWhilePreReady",
			message: MSG,
		});
		expect(r.state.pending).toBe(MSG);
		expect(r.effects).toEqual([{ kind: "acquire" }]);
	});

	it("queue-of-one: a second send while full is a no-op (no overwrite)", () => {
		for (const type of ["sendWhileStreaming", "sendWhilePreReady"] as const) {
			const r = queueOrchestrationReducer(FULL, { type, message: MSG2 });
			expect(r.state.pending).toBe(MSG); // original preserved
			expect(r.effects).toEqual([]);
		}
	});
});

describe("queueOrchestrationReducer — turnEnded (the Q4 flush)", () => {
	it("normal turn end with pending → flush (clear then raw dispatch of the held msg)", () => {
		const r = queueOrchestrationReducer(FULL, {
			type: "turnEnded",
			hadError: false,
			wasCancelled: false,
		});
		expect(r.state.pending).toBeNull();
		expect(r.effects).toEqual([
			{ kind: "clearComposer" },
			{ kind: "flushDispatch", message: MSG },
		]);
	});

	it("hold on error", () => {
		const r = queueOrchestrationReducer(FULL, {
			type: "turnEnded",
			hadError: true,
			wasCancelled: false,
		});
		expect(r.state.pending).toBe(MSG); // held, degrades to draft later
		expect(r.effects).toEqual([]);
	});

	it("hold on cancel", () => {
		const r = queueOrchestrationReducer(FULL, {
			type: "turnEnded",
			hadError: false,
			wasCancelled: true,
		});
		expect(r.state.pending).toBe(MSG);
		expect(r.effects).toEqual([]);
	});

	it("no pending → no-op", () => {
		const r = queueOrchestrationReducer(EMPTY, {
			type: "turnEnded",
			hadError: false,
			wasCancelled: false,
		});
		expect(r.state.pending).toBeNull();
		expect(r.effects).toEqual([]);
	});
});

describe("queueOrchestrationReducer — acquisitionComplete / Failed", () => {
	it("pending + sessionId committed → flush", () => {
		const r = queueOrchestrationReducer(FULL, {
			type: "acquisitionComplete",
			hasSessionId: true,
		});
		expect(r.state.pending).toBeNull();
		expect(r.effects).toEqual([
			{ kind: "clearComposer" },
			{ kind: "flushDispatch", message: MSG },
		]);
	});

	it("pending but sessionId NOT yet committed → hold (I69 guard)", () => {
		const r = queueOrchestrationReducer(FULL, {
			type: "acquisitionComplete",
			hasSessionId: false,
		});
		expect(r.state.pending).toBe(MSG);
		expect(r.effects).toEqual([]);
	});

	it("no pending → no-op", () => {
		const r = queueOrchestrationReducer(EMPTY, {
			type: "acquisitionComplete",
			hasSessionId: true,
		});
		expect(r.effects).toEqual([]);
	});

	it("acquisitionFailed → hold (composer keeps text, user retries)", () => {
		const r = queueOrchestrationReducer(FULL, { type: "acquisitionFailed" });
		expect(r.state.pending).toBe(MSG);
		expect(r.effects).toEqual([]);
	});
});

describe("queueOrchestrationReducer — edit / delete", () => {
	it("editQueued → release slot, KEEP composer text", () => {
		const r = queueOrchestrationReducer(FULL, { type: "editQueued" });
		expect(r.state.pending).toBeNull();
		expect(r.effects).toEqual([]); // no clearComposer
	});

	it("deleteQueued → release slot AND clear composer", () => {
		const r = queueOrchestrationReducer(FULL, { type: "deleteQueued" });
		expect(r.state.pending).toBeNull();
		expect(r.effects).toEqual([{ kind: "clearComposer" }]);
	});
});

describe("queueOrchestrationReducer — resume / respawn (cross-agent + restart semantics)", () => {
	it("resume with canResume=true → keep pending (re-flushes on next ready/turn-end)", () => {
		const r = queueOrchestrationReducer(FULL, {
			type: "resume",
			canResume: true,
		});
		expect(r.state.pending).toBe(MSG);
		expect(r.effects).toEqual([]);
	});

	it("resume with canResume=false → degrade to draft (agent can't loadSession)", () => {
		const r = queueOrchestrationReducer(FULL, {
			type: "resume",
			canResume: false,
		});
		expect(r.state.pending).toBeNull();
		expect(r.effects).toEqual([]); // keep composer text, no auto-fire
	});

	it("respawn → degrade to preserved draft (no auto-fire into the fresh session)", () => {
		const r = queueOrchestrationReducer(FULL, { type: "respawn" });
		expect(r.state.pending).toBeNull();
		expect(r.effects).toEqual([]);
	});

	it("respawn on empty slot → no-op", () => {
		const r = queueOrchestrationReducer(EMPTY, { type: "respawn" });
		expect(r.state.pending).toBeNull();
		expect(r.effects).toEqual([]);
	});
});

// ============================================================================
// The Q4 guard — reproduce-first: a flush must dispatch RAW, by construction
// ============================================================================

describe("Q4 guard — flush is raw-by-construction, independent of any busy snapshot", () => {
	it("turnEnded flushes via flushDispatch (the reducer never reads lazySession.state)", () => {
		// Q4 was: the turn-end flush read a stale `busy` snapshot and routed
		// through the re-enqueuing wrapper → orphan. Here `turnEnded` is its own
		// event carrying only {hadError,wasCancelled}; there is NO session-state
		// input to be stale. The flush is emitted purely from the slot + turn
		// outcome, so the racy field can't change the decision.
		const r = queueOrchestrationReducer(FULL, {
			type: "turnEnded",
			hadError: false,
			wasCancelled: false,
		});
		const flushEffects = r.effects.filter((e) => e.kind === "flushDispatch");
		expect(flushEffects).toHaveLength(1);
		expect(flushEffects[0]).toEqual({ kind: "flushDispatch", message: MSG });
	});

	it("the flushDispatch effect carries ONLY a message — no dispatch-function/raw-vs-wrapper field", () => {
		// Structural guard: the effect cannot encode a wrapper choice, so the
		// adapter can only ever map it to the raw send. This is what closes the
		// wiring blind spot (re-wiring the wrapper back is impossible).
		const r = queueOrchestrationReducer(FULL, {
			type: "turnEnded",
			hadError: false,
			wasCancelled: false,
		});
		const flush = r.effects.find((e) => e.kind === "flushDispatch") as Extract<
			QueueEffect,
			{ kind: "flushDispatch" }
		>;
		expect(Object.keys(flush).sort()).toEqual(["kind", "message"]);
	});
});

// ============================================================================
// Property tests (fast-check) — totality, single-slot, ordering, no-orphan
// ============================================================================

const msgArb: fc.Arbitrary<QueuedMessage> = fc.record({
	content: fc.string(),
	attachments: fc.option(fc.constant([]), { nil: undefined }),
});

const stateArb: fc.Arbitrary<QueueOrchestrationState> = fc.oneof(
	fc.constant<QueueOrchestrationState>({ pending: null }),
	msgArb.map((m) => ({ pending: m })),
);

const eventArb: fc.Arbitrary<QueueEvent> = fc.oneof(
	msgArb.map((m) => ({ type: "sendWhileReady" as const, message: m })),
	msgArb.map((m) => ({ type: "sendWhileStreaming" as const, message: m })),
	msgArb.map((m) => ({ type: "sendWhilePreReady" as const, message: m })),
	fc.record({ hadError: fc.boolean(), wasCancelled: fc.boolean() }).map((c) => ({
		type: "turnEnded" as const,
		...c,
	})),
	fc.boolean().map((b) => ({ type: "acquisitionComplete" as const, hasSessionId: b })),
	fc.constant({ type: "acquisitionFailed" as const }),
	fc.constant({ type: "editQueued" as const }),
	fc.constant({ type: "deleteQueued" as const }),
	fc.boolean().map((b) => ({ type: "resume" as const, canResume: b })),
	fc.constant({ type: "respawn" as const }),
);

const KNOWN_EFFECT_KINDS = new Set(["acquire", "flushDispatch", "clearComposer"]);

describe("queueOrchestrationReducer — properties", () => {
	it("totality: every (state, event) → a valid result; never throws", () => {
		fc.assert(
			fc.property(stateArb, eventArb, (state, event) => {
				const r = queueOrchestrationReducer(state, event);
				expect(r.state.pending === null || typeof r.state.pending === "object").toBe(
					true,
				);
				expect(Array.isArray(r.effects)).toBe(true);
				for (const e of r.effects) {
					expect(KNOWN_EFFECT_KINDS.has(e.kind)).toBe(true);
				}
			}),
		);
	});

	it("single-slot invariant: pending is always a single message or null (never overwritten while full)", () => {
		fc.assert(
			fc.property(msgArb, eventArb, (held, event) => {
				const r = queueOrchestrationReducer({ pending: held }, event);
				// A send event must never replace the held message.
				if (event.type.startsWith("sendWhile")) {
					expect(r.state.pending).toBe(held);
				}
				// pending is never anything other than null or a QueuedMessage.
				expect(
					r.state.pending === null ||
						typeof (r.state.pending as QueuedMessage).content === "string",
				).toBe(true);
			}),
		);
	});

	it("flush ordering: any flushDispatch is immediately preceded by clearComposer", () => {
		fc.assert(
			fc.property(stateArb, eventArb, (state, event) => {
				const r = queueOrchestrationReducer(state, event);
				const i = r.effects.findIndex((e) => e.kind === "flushDispatch");
				if (i >= 0) {
					expect(i).toBeGreaterThan(0);
					expect(r.effects[i - 1].kind).toBe("clearComposer");
				}
			}),
		);
	});

	it("no-orphan: a flush from turnEnded/acquisitionComplete dispatches exactly the consumed slot and empties it", () => {
		fc.assert(
			fc.property(msgArb, (held) => {
				for (const event of [
					{ type: "turnEnded" as const, hadError: false, wasCancelled: false },
					{ type: "acquisitionComplete" as const, hasSessionId: true },
				]) {
					const r = queueOrchestrationReducer({ pending: held }, event);
					const flush = r.effects.find((e) => e.kind === "flushDispatch") as
						| Extract<QueueEffect, { kind: "flushDispatch" }>
						| undefined;
					expect(flush?.message).toBe(held);
					expect(r.state.pending).toBeNull();
				}
			}),
		);
	});

	it("isQueued selector tracks pending", () => {
		expect(isQueued(initialQueueState)).toBe(false);
		expect(isQueued({ pending: MSG })).toBe(true);
	});
});
