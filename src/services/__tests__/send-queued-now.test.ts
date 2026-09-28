/**
 * Send now on the locked (queued) composer.
 *
 * A queued message waits for the current turn to finish. "Send now" promotes
 * it to a steer: stop the live turn, then send the held message once the stop
 * settles (the existing #81 settle-before-send path). When no turn is running
 * (the message was held after the user pressed Stop), it sends immediately.
 *
 * Three decision layers, each tested at its own seam:
 *  1. `queueOrchestrationReducer` — the `sendQueuedNow` transition.
 *  2. `deriveQueuedBannerActions` — which banner buttons show.
 *  3. `decideComposerEnterAction` — the steer gesture on a locked composer.
 */
import { describe, it, expect } from "vitest";
import {
	queueOrchestrationReducer,
	type QueueOrchestrationState,
} from "../queue-orchestration-reducer";
import { decideComposerEnterAction } from "../message-queue-logic";
import { deriveQueuedBannerActions } from "../../resolvers/queued-banner-actions";
import type { QueuedMessage } from "../../types/chat";

const MSG: QueuedMessage = { content: "do the other thing" };
const HELD: QueueOrchestrationState = { pending: MSG };

describe("queueOrchestrationReducer — sendQueuedNow", () => {
	it("while streaming → promote to steer: flag steering + cancel the turn", () => {
		const r = queueOrchestrationReducer(HELD, {
			type: "sendQueuedNow",
			isStreaming: true,
		});
		expect(r.state.pending).toBe(MSG);
		expect(r.state.steering).toBe(true);
		expect(r.effects).toEqual([{ kind: "cancelTurn" }]);
	});

	it("promoted message flushes on steerCancelSettled (clear + raw send)", () => {
		const promoted = queueOrchestrationReducer(HELD, {
			type: "sendQueuedNow",
			isStreaming: true,
		}).state;
		// The cancel's turn-end edge must NOT flush it (I165 ordering).
		const atTurnEnd = queueOrchestrationReducer(promoted, {
			type: "turnEnded",
			hadError: false,
			wasCancelled: true,
		});
		expect(atTurnEnd.effects).toEqual([]);
		const settled = queueOrchestrationReducer(atTurnEnd.state, {
			type: "steerCancelSettled",
		});
		expect(settled.state.pending).toBeNull();
		expect(settled.effects).toEqual([
			{ kind: "clearComposer" },
			{ kind: "flushDispatch", message: MSG },
		]);
	});

	it("not streaming (held after Stop) → send immediately", () => {
		const r = queueOrchestrationReducer(HELD, {
			type: "sendQueuedNow",
			isStreaming: false,
		});
		expect(r.state.pending).toBeNull();
		expect(r.effects).toEqual([
			{ kind: "clearComposer" },
			{ kind: "flushDispatch", message: MSG },
		]);
	});

	it("empty slot → no-op", () => {
		const empty: QueueOrchestrationState = { pending: null };
		const r = queueOrchestrationReducer(empty, {
			type: "sendQueuedNow",
			isStreaming: true,
		});
		expect(r.state).toBe(empty);
		expect(r.effects).toEqual([]);
	});

	it("already steering → no-op (no second cancel)", () => {
		const steering: QueueOrchestrationState = { pending: MSG, steering: true };
		const r = queueOrchestrationReducer(steering, {
			type: "sendQueuedNow",
			isStreaming: true,
		});
		expect(r.state).toBe(steering);
		expect(r.effects).toEqual([]);
	});

	it("waiting for the session to connect → no-op (it sends on connect)", () => {
		const waiting: QueueOrchestrationState = {
			pending: MSG,
			awaitingAcquire: true,
		};
		for (const isStreaming of [true, false]) {
			const r = queueOrchestrationReducer(waiting, {
				type: "sendQueuedNow",
				isStreaming,
			});
			expect(r.state).toBe(waiting);
			expect(r.effects).toEqual([]);
		}
	});

	it("held surface action → no-op (it keeps its own Cancel path)", () => {
		const action: QueueOrchestrationState = {
			pending: { content: "x", detachedSurfaceId: "s-1" },
		};
		const r = queueOrchestrationReducer(action, {
			type: "sendQueuedNow",
			isStreaming: true,
		});
		expect(r.state).toBe(action);
		expect(r.effects).toEqual([]);
	});
});

describe("deriveQueuedBannerActions — truth table", () => {
	it.each([
		// isAction, isSessionReady, expected
		[false, true, ["sendNow", "edit", "delete"]],
		[false, false, ["edit", "delete"]],
		[true, true, ["cancel"]],
		[true, false, ["cancel"]],
	] as const)(
		"isAction=%s isSessionReady=%s → %j",
		(isAction, isSessionReady, expected) => {
			expect(deriveQueuedBannerActions({ isAction, isSessionReady })).toEqual(
				expected,
			);
		},
	);
});

describe("decideComposerEnterAction — steer gesture on a locked composer", () => {
	const locked = {
		isStreaming: true,
		isSessionReady: true,
		isButtonDisabled: true,
		isQueued: true,
		// A locked composer still shows the queued text.
		hasContent: true,
	};

	it("steer gesture → sendQueuedNow", () => {
		expect(
			decideComposerEnterAction({ ...locked, steerRequested: true }),
		).toBe("sendQueuedNow");
	});

	it("also when no turn is running (held after Stop)", () => {
		expect(
			decideComposerEnterAction({
				...locked,
				isStreaming: false,
				steerRequested: true,
			}),
		).toBe("sendQueuedNow");
	});

	it("plain send key still does nothing (queue-of-one)", () => {
		expect(decideComposerEnterAction(locked)).toBe("none");
	});

	it("not while the session is still connecting", () => {
		expect(
			decideComposerEnterAction({
				...locked,
				isSessionReady: false,
				steerRequested: true,
			}),
		).toBe("none");
	});

	it("not for a held surface action", () => {
		expect(
			decideComposerEnterAction({
				...locked,
				steerRequested: true,
				queuedIsAction: true,
			}),
		).toBe("none");
	});
});
