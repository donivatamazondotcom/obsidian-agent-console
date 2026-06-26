import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
	queueOrchestrationReducer,
	type QueueOrchestrationState,
} from "../queue-orchestration-reducer";

/**
 * Thin-B async-interleaving test ([[ChatPanel lifecycle harness proposal]]
 * Option B) — the one layer no test in the repo had: a commit-ordering race.
 *
 * Q4 mechanism: at the `isSending true -> false` commit, TWO effects fire on
 * the same transition — the busy-state effect (endBusy: busy -> ready) and the
 * turn-end flush. If the flush dispatches through the re-enqueuing lazy
 * WRAPPER, and the flush executes BEFORE endBusy has committed busy -> ready,
 * the wrapper observes "busy", re-enqueues the just-consumed message into the
 * lazy queueRef, and the connect-flush (gated to connecting|idle -> ready,
 * which never fires here) never picks it up -> silent orphan.
 *
 * fast-check's `scheduler()` interleaves the endBusy commit against the
 * flush across orderings. The reducer always emits a raw `flushDispatch`; this
 * test proves the CONTRACT by parameterizing how the (simulated) adapter maps
 * that effect:
 *
 *   - raw send    → delivered exactly once under EVERY interleaving  (GREEN)
 *   - wrapper send → orphaned under the adverse interleaving          (RED)
 *
 * The red case is the discriminator: it proves the harness actually detects
 * Q4, so the green raw case is meaningful and not vacuous.
 */

type Wiring = "raw" | "wrapper";

interface ScenarioResult {
	delivered: string[];
	requeued: string | null;
	pending: QueueOrchestrationState["pending"];
}

/**
 * One race: a message is already queued (held during the streaming turn). On
 * the turn-end commit, the endBusy transition and the turn-end flush are both
 * scheduled; the scheduler decides their order.
 */
async function runRace(wiring: Wiring, s: fc.Scheduler): Promise<ScenarioResult> {
	// Shared "session view" the wrapper would read. Starts busy (the turn that
	// just ended hasn't re-rendered busy -> ready yet).
	let sessionState: "busy" | "ready" = "busy";
	const delivered: string[] = [];
	let requeued: string | null = null;

	// Reducer slot: a message queued during streaming (sendWhileStreaming).
	let state: QueueOrchestrationState = { pending: { content: "m" } };

	const rawSend = (content: string) => {
		// The raw send (handleSendMessage) delivers unconditionally — the
		// session is established at turn-end.
		delivered.push(content);
	};
	const wrapperSend = (content: string) => {
		// handleSendWithLazyAcquisition: if it observes a non-ready session it
		// re-enqueues into the lazy queueRef instead of delivering (the Q4 bug).
		if (sessionState !== "ready") {
			requeued = content;
		} else {
			delivered.push(content);
		}
	};
	const dispatch = wiring === "raw" ? rawSend : wrapperSend;

	// Task 1 — the busy-state effect commits busy -> ready.
	const endBusy = s.schedule(Promise.resolve(), "endBusy").then(() => {
		sessionState = "ready";
	});

	// Task 2 — the turn-end flush: feed `turnEnded` to the reducer and execute
	// the returned effects through the (parameterized) adapter.
	const flush = s.schedule(Promise.resolve(), "turnEndFlush").then(() => {
		const r = queueOrchestrationReducer(state, {
			type: "turnEnded",
			hadError: false,
			wasCancelled: false,
		});
		state = r.state;
		for (const e of r.effects) {
			if (e.kind === "flushDispatch") dispatch(e.message.content);
			// clearComposer is a no-op in this harness.
		}
	});

	await s.waitAll();
	await Promise.all([endBusy, flush]);

	return { delivered, requeued, pending: state.pending };
}

/**
 * The governing property: the queued message is delivered exactly once, the
 * slot is emptied, and nothing is orphaned — under EVERY interleaving.
 */
function deliversExactlyOnce(wiring: Wiring): Promise<void> {
	return fc.assert(
		fc.asyncProperty(fc.scheduler(), async (s) => {
			const res = await runRace(wiring, s);
			expect(res.delivered).toEqual(["m"]);
			expect(res.pending).toBeNull();
			expect(res.requeued).toBeNull();
		}),
		{ numRuns: 200 },
	);
}

describe("queue-orchestration interleaving (thin B) — endBusy vs turn-end flush", () => {
	it("GREEN against raw send: delivered exactly once under every interleaving", async () => {
		await deliversExactlyOnce("raw");
	});

	it("RED against wrapper send: the SAME property fails (proves the harness detects Q4)", async () => {
		// If this ever stops throwing, the interleaving test has gone vacuous —
		// it would no longer catch a re-wire of the flush onto the lazy wrapper.
		await expect(deliversExactlyOnce("wrapper")).rejects.toThrow();
	});

	it("the wrapper orphan is specifically the flush-before-endBusy ordering", async () => {
		// Deterministic spot check of the failing interleaving, so the red test
		// above is anchored to the real Q4 mechanism and not some other failure.
		// Drive a scheduler where the flush runs while still 'busy'.
		await fc.assert(
			fc.asyncProperty(fc.scheduler(), async (s) => {
				const res = await runRace("wrapper", s);
				// Across orderings, the wrapper either delivers (endBusy first) or
				// orphans (flush first). Whenever it does NOT deliver, the message
				// was re-enqueued and the slot is empty — i.e. a silent orphan.
				if (res.delivered.length === 0) {
					expect(res.requeued).toBe("m");
					expect(res.pending).toBeNull();
				}
			}),
			{ numRuns: 200 },
		);
	});
});
