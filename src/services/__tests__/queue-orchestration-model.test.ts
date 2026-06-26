import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
	queueOrchestrationReducer,
	initialQueueState,
	type QueueEvent,
	type QueueEffect,
	type QueueOrchestrationState,
} from "../queue-orchestration-reducer";

/**
 * Model-based queue-orchestration test — the generated counterpart to the
 * hand-written transition tests, converging with `lifecycle-model.test.ts`'s
 * `fc.commands` pattern (but scoped to the queue slot, not the tab-agent
 * invariant, so each model stays single-concern).
 *
 * `fc.commands` generates random sequences over
 * {sendStreaming, sendPreReady, turnEnd, acqComplete, acqFailed, edit, delete,
 * resume, respawn} and drives them through a simulator wrapping the REAL
 * reducer. After EVERY command three invariants must hold:
 *
 *   1. single-slot — `pending` is null or exactly one message (never a pair).
 *   2. flush-consumes — a `flushDispatch` effect appears iff there was a
 *      pending message to consume, dispatches exactly that message, and leaves
 *      the slot empty (no orphan, no double-dispatch).
 *   3. no-spurious-flush — a flush never fires from an empty slot.
 */

const AGENTS_MSGS = ["a", "b", "c"] as const;

class QueueSim {
	state: QueueOrchestrationState = initialQueueState;
	delivered: string[] = [];

	/** Apply an event, execute flush effects, and assert the invariants. */
	apply(event: QueueEvent): void {
		const prePending = this.state.pending;
		const r = queueOrchestrationReducer(this.state, event);
		this.state = r.state;

		const flushes = r.effects.filter(
			(e): e is Extract<QueueEffect, { kind: "flushDispatch" }> =>
				e.kind === "flushDispatch",
		);

		// Invariant 1 — single-slot.
		expect(
			this.state.pending === null ||
				typeof this.state.pending.content === "string",
		).toBe(true);

		// Invariant 3 — no flush without a pre-existing pending message,
		// EXCEPT sendWhileReady which dispatches its own (just-sent) message
		// without ever touching the slot.
		if (event.type !== "sendWhileReady") {
			if (flushes.length > 0) {
				// Invariant 2 — flush-consumes: exactly the held message, slot emptied.
				expect(flushes).toHaveLength(1);
				expect(prePending).not.toBeNull();
				expect(flushes[0].message).toBe(prePending);
				expect(this.state.pending).toBeNull();
			}
		} else {
			// sendWhileReady: dispatches the carried message, slot untouched.
			expect(flushes).toHaveLength(1);
			expect(flushes[0].message).toBe(event.message);
			expect(this.state.pending).toBe(prePending);
		}

		for (const f of flushes) this.delivered.push(f.message.content);
	}
}

interface Model {
	open: boolean;
}
type Real = QueueSim;

const msgArb = fc
	.constantFrom(...AGENTS_MSGS)
	.map((content) => ({ content }) as const);

class SendStreamingCmd implements fc.Command<Model, Real> {
	constructor(private msg: { content: string }) {}
	check = () => true;
	run(_m: Model, r: Real): void {
		r.apply({ type: "sendWhileStreaming", message: this.msg });
	}
	toString = () => `sendStreaming(${this.msg.content})`;
}
class SendPreReadyCmd implements fc.Command<Model, Real> {
	constructor(private msg: { content: string }) {}
	check = () => true;
	run(_m: Model, r: Real): void {
		r.apply({ type: "sendWhilePreReady", message: this.msg });
	}
	toString = () => `sendPreReady(${this.msg.content})`;
}
class TurnEndCmd implements fc.Command<Model, Real> {
	constructor(
		private hadError: boolean,
		private wasCancelled: boolean,
	) {}
	check = () => true;
	run(_m: Model, r: Real): void {
		r.apply({
			type: "turnEnded",
			hadError: this.hadError,
			wasCancelled: this.wasCancelled,
		});
	}
	toString = () => `turnEnd(err=${this.hadError},cancel=${this.wasCancelled})`;
}
class AcqCompleteCmd implements fc.Command<Model, Real> {
	constructor(private hasSessionId: boolean) {}
	check = () => true;
	run(_m: Model, r: Real): void {
		r.apply({ type: "acquisitionComplete", hasSessionId: this.hasSessionId });
	}
	toString = () => `acqComplete(sid=${this.hasSessionId})`;
}
class AcqFailedCmd implements fc.Command<Model, Real> {
	check = () => true;
	run(_m: Model, r: Real): void {
		r.apply({ type: "acquisitionFailed" });
	}
	toString = () => "acqFailed";
}
class EditCmd implements fc.Command<Model, Real> {
	check = () => true;
	run(_m: Model, r: Real): void {
		r.apply({ type: "editQueued" });
	}
	toString = () => "edit";
}
class DeleteCmd implements fc.Command<Model, Real> {
	check = () => true;
	run(_m: Model, r: Real): void {
		r.apply({ type: "deleteQueued" });
	}
	toString = () => "delete";
}
class ResumeCmd implements fc.Command<Model, Real> {
	constructor(private canResume: boolean) {}
	check = () => true;
	run(_m: Model, r: Real): void {
		r.apply({ type: "resume", canResume: this.canResume });
	}
	toString = () => `resume(${this.canResume})`;
}
class RespawnCmd implements fc.Command<Model, Real> {
	check = () => true;
	run(_m: Model, r: Real): void {
		r.apply({ type: "respawn" });
	}
	toString = () => "respawn";
}

describe("queue-orchestration — model-based (random command sequences)", () => {
	it("single-slot + flush-consumes + no-spurious-flush hold after every command", () => {
		const commandArbs = [
			msgArb.map((m) => new SendStreamingCmd(m)),
			msgArb.map((m) => new SendPreReadyCmd(m)),
			fc
				.record({ hadError: fc.boolean(), wasCancelled: fc.boolean() })
				.map((c) => new TurnEndCmd(c.hadError, c.wasCancelled)),
			fc.boolean().map((b) => new AcqCompleteCmd(b)),
			fc.constant(new AcqFailedCmd()),
			fc.constant(new EditCmd()),
			fc.constant(new DeleteCmd()),
			fc.boolean().map((b) => new ResumeCmd(b)),
			fc.constant(new RespawnCmd()),
		];

		fc.assert(
			fc.property(fc.commands(commandArbs, { maxCommands: 50 }), (cmds) => {
				const setup = () => ({
					model: { open: true },
					real: new QueueSim(),
				});
				fc.modelRun(setup, cmds);
			}),
		);
	});
});
