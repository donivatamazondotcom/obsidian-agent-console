/**
 * I204 — a queued message must not stay locked after Stop or an errored reply.
 *
 * Before: `turnEnded { wasCancelled | hadError }` returned the state unchanged.
 * The slot stayed full, but the turn it was waiting on was gone, so nothing
 * would ever flush it. The composer stayed locked under a "sends when done"
 * banner that never sent.
 *
 * After (Decision 5, amended): cancel/error still NEVER auto-send, but the
 * held message degrades to a plain draft — slot released, composer text kept
 * (no `clearComposer`, no `flushDispatch`). A steer-held message is the one
 * exception: it keeps waiting for `steerCancelSettled` (I165 ordering).
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
	queueOrchestrationReducer,
	initialQueueState,
	type QueueEvent,
	type QueueOrchestrationState,
} from "../queue-orchestration-reducer";
import type { QueuedMessage } from "../../types/chat";

const MSG: QueuedMessage = { content: "follow-up question" };
const HELD: QueueOrchestrationState = { pending: MSG };

const CANCELLED: QueueEvent = {
	type: "turnEnded",
	hadError: false,
	wasCancelled: true,
};
const ERRORED: QueueEvent = {
	type: "turnEnded",
	hadError: true,
	wasCancelled: false,
};

describe("I204 — turnEnded after Stop/error degrades the queued message to a draft", () => {
	it("cancelled turn → slot released, composer text kept, nothing sent", () => {
		const r = queueOrchestrationReducer(HELD, CANCELLED);
		expect(r.state.pending).toBeNull();
		expect(r.effects).toEqual([]); // no clearComposer, no flushDispatch
	});

	it("errored turn → slot released, composer text kept, nothing sent", () => {
		const r = queueOrchestrationReducer(HELD, ERRORED);
		expect(r.state.pending).toBeNull();
		expect(r.effects).toEqual([]);
	});

	it("cancelled AND errored → same draft outcome", () => {
		const r = queueOrchestrationReducer(HELD, {
			type: "turnEnded",
			hadError: true,
			wasCancelled: true,
		});
		expect(r.state.pending).toBeNull();
		expect(r.effects).toEqual([]);
	});

	it("a held surface action (detachedSurfaceId) is released too, never sent", () => {
		const surface: QueueOrchestrationState = {
			pending: { content: "choice:a", detachedSurfaceId: "surf-1" },
		};
		for (const ev of [CANCELLED, ERRORED]) {
			const r = queueOrchestrationReducer(surface, ev);
			expect(r.state.pending).toBeNull();
			expect(r.effects).toEqual([]);
		}
	});

	it("after degrading, a new send queues normally (the slot is usable again)", () => {
		const degraded = queueOrchestrationReducer(HELD, CANCELLED).state;
		const r = queueOrchestrationReducer(degraded, {
			type: "sendWhileStreaming",
			message: { content: "retyped" },
		});
		expect(r.state.pending).toEqual({ content: "retyped" });
	});
});

describe("I204 regression guard — the steer path is unchanged (I165)", () => {
	it("a steer-held message still HOLDS on the cancel's turnEnded", () => {
		const steering = queueOrchestrationReducer(initialQueueState, {
			type: "steerWhileStreaming",
			message: MSG,
		}).state;
		for (const ev of [CANCELLED, ERRORED]) {
			const r = queueOrchestrationReducer(steering, ev);
			expect(r.state.pending).toBe(MSG);
			expect(r.state.steering).toBe(true);
			expect(r.effects).toEqual([]);
		}
	});

	it("…and flushes only on steerCancelSettled", () => {
		const steering = queueOrchestrationReducer(initialQueueState, {
			type: "steerWhileStreaming",
			message: MSG,
		}).state;
		const afterTurnEnd = queueOrchestrationReducer(steering, CANCELLED).state;
		const r = queueOrchestrationReducer(afterTurnEnd, {
			type: "steerCancelSettled",
		});
		expect(r.state.pending).toBeNull();
		expect(r.effects).toEqual([
			{ kind: "clearComposer" },
			{ kind: "flushDispatch", message: MSG },
		]);
	});

	it("a Send-now promotion (sendQueuedNow while streaming) also waits for steerCancelSettled", () => {
		const promoted = queueOrchestrationReducer(HELD, {
			type: "sendQueuedNow",
			isStreaming: true,
		}).state;
		const afterTurnEnd = queueOrchestrationReducer(promoted, CANCELLED);
		expect(afterTurnEnd.state.pending).toBe(MSG);
		expect(afterTurnEnd.effects).toEqual([]);
	});
});

describe("I204 property — no non-steer message survives a cancelled/errored turn", () => {
	const msgArb = fc
		.string({ minLength: 1, maxLength: 8 })
		.map((content): QueuedMessage => ({ content }));
	const endArb = fc
		.record({ hadError: fc.boolean(), wasCancelled: fc.boolean() })
		.filter((e) => e.hadError || e.wasCancelled);

	it("for any held (non-steer) message, a failed turn end releases the slot and never sends", () => {
		fc.assert(
			fc.property(msgArb, endArb, fc.boolean(), (msg, end, preReady) => {
				const held = queueOrchestrationReducer(initialQueueState, {
					type: preReady ? "sendWhilePreReady" : "sendWhileStreaming",
					message: msg,
				}).state;
				const r = queueOrchestrationReducer(held, {
					type: "turnEnded",
					...end,
				});
				expect(r.state.pending).toBeNull();
				expect(r.effects.some((e) => e.kind === "flushDispatch")).toBe(false);
				expect(r.effects.some((e) => e.kind === "clearComposer")).toBe(false);
			}),
		);
	});
});

/**
 * Broadcast-cancel reaches the same `turnEnded { wasCancelled: true }` edge
 * per tab ONLY if each tab's `cancelOperation` goes through the cancel-flag
 * stop wrapper. If it were ever rewired to the raw stop, `wasCancelled` would
 * be false, the reducer would read the stop as a normal turn end, and the
 * queued message would AUTO-SEND (violating Decision 5). Static wiring guard,
 * same pattern as the send-queued-now banner wiring test.
 */
describe("I204 — broadcast-cancel routes through the cancel-flag stop", () => {
	it("ChatPanel's cancelOperation uses handleStopGenerationRef, which tracks handleStopWithCancelFlag", async () => {
		const { readFileSync } = await import("node:fs");
		const { resolve } = await import("node:path");
		const src = readFileSync(
			resolve(process.cwd(), "src/ui/ChatPanel.tsx"),
			"utf8",
		);
		// The ref is kept pointed at the flag-setting wrapper.
		expect(src).toMatch(
			/handleStopGenerationRef\.current\s*=\s*handleStopWithCancelFlag/,
		);
		// The wrapper marks the turn cancelled before stopping.
		expect(src).toMatch(
			/handleStopWithCancelFlag\s*=\s*useCallback\(async \(\) => \{\s*cancelledRef\.current = true;/,
		);
		// The per-tab cancel handle (what broadcastCancel calls) uses the ref.
		const cancelOp = src.slice(src.indexOf("cancelOperation: async () => {"));
		expect(cancelOp.slice(0, 300)).toContain("handleStopGenerationRef.current()");
	});
});
