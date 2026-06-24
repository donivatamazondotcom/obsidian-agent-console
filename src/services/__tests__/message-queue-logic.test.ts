/**
 * Tests for the queue-next-message decision logic (#82).
 *
 * Reproduce-first: each guard is paired with the NAIVE predicate a too-simple
 * implementation would use (modelled inline, same pattern as the I70 test).
 * The naive predicate is asserted to exhibit the bug (the red bar); the real
 * helper is asserted to prevent it (green). See
 * [[Agent Console Queue Next Message]] Decision 5 and the broadcast skip-guard.
 */
import { describe, it, expect, vi } from "vitest";
import {
	shouldQueueOnSend,
	shouldFlushQueue,
	decideComposerEnterAction,
	buildComposerPlaceholder,
	isQueuedSendBlocked,
	executeFlush,
	selectBroadcastSendTargets,
	selectBroadcastPromptTargets,
	type FlushDecisionParams,
	type BroadcastTarget,
} from "../message-queue-logic";

// --- T3 / T4: flush routes through the send path AND clears the composer ---

describe("executeFlush — clear-before-dispatch ordering (T3, T4)", () => {
	it("T3 — consumes the queued payload and dispatches it", () => {
		const dispatch = vi.fn();
		const flushed = executeFlush({
			consume: () => ({ content: "next turn", attachments: undefined }),
			clearComposer: () => {},
			dispatch,
		});
		expect(flushed).toBe(true);
		expect(dispatch).toHaveBeenCalledWith("next turn", undefined);
	});

	it("T4 — clears the composer BEFORE dispatching (so empty persists)", () => {
		const calls: string[] = [];
		executeFlush({
			consume: () => ({ content: "x" }),
			clearComposer: () => calls.push("clear"),
			dispatch: () => calls.push("dispatch"),
		});
		expect(calls).toEqual(["clear", "dispatch"]);
	});

	it("does nothing (no dispatch) when the queue is empty", () => {
		const dispatch = vi.fn();
		const flushed = executeFlush({
			consume: () => null,
			clearComposer: () => {
				throw new Error("must not clear when empty");
			},
			dispatch,
		});
		expect(flushed).toBe(false);
		expect(dispatch).not.toHaveBeenCalled();
	});
});

// --- T1 / T13: composer Enter-key action -----------------------------------

describe("decideComposerEnterAction (T1, T13)", () => {
	const base = {
		isStreaming: false,
		isButtonDisabled: false,
		isQueued: false,
		hasContent: true,
	};

	it("sends when idle with the button enabled", () => {
		expect(decideComposerEnterAction(base)).toBe("send");
	});

	it("T1 — queues while streaming with content and nothing queued yet", () => {
		expect(
			decideComposerEnterAction({ ...base, isStreaming: true }),
		).toBe("queue");
	});

	it("T13 — does nothing while streaming if a message is already queued", () => {
		expect(
			decideComposerEnterAction({
				...base,
				isStreaming: true,
				isQueued: true,
			}),
		).toBe("none");
	});

	it("does nothing while streaming with an empty composer", () => {
		expect(
			decideComposerEnterAction({
				...base,
				isStreaming: true,
				hasContent: false,
			}),
		).toBe("none");
	});

	it("does nothing when the button is disabled (connecting/restoring)", () => {
		expect(
			decideComposerEnterAction({ ...base, isButtonDisabled: true }),
		).toBe("none");
	});
});

// --- issue 3: held queued message must block the Send button ---------------

describe("isQueuedSendBlocked (smoke-test issue 3)", () => {
	it("reproduce — a held queued message (queued, not streaming) blocks send", () => {
		// Naive (pre-fix) behavior had no such guard → the Send button fired the
		// locked text, bypassing the queue.
		expect(isQueuedSendBlocked({ isQueued: true, isSending: false })).toBe(
			true,
		);
	});

	it("does NOT block during streaming — the button is Stop, must stay live (T7)", () => {
		expect(isQueuedSendBlocked({ isQueued: true, isSending: true })).toBe(
			false,
		);
	});

	it("does not block when nothing is queued", () => {
		expect(isQueuedSendBlocked({ isQueued: false, isSending: false })).toBe(
			false,
		);
	});
});

// --- composer placeholder affordance (option A, queue-only) -----------------

describe("buildComposerPlaceholder (streaming hint)", () => {
	const base = { agentLabel: "Auto SA", hasCommands: true, isStreaming: false, isQueued: false };

	it("idle: teaches mention/command affordances", () => {
		expect(buildComposerPlaceholder(base)).toBe(
			"Message Auto SA - @ to mention notes, / for commands",
		);
	});

	it("streaming: teaches the Enter-to-queue keybinding", () => {
		const p = buildComposerPlaceholder({ ...base, isStreaming: true });
		expect(p).toBe("Queue a message – hit Enter to send when Auto SA is done");
	});

	it("queue-only wording for now (no steering mention yet)", () => {
		const p = buildComposerPlaceholder({ ...base, isStreaming: true });
		expect(p.toLowerCase()).not.toContain("steer");
	});

	it("streaming but already queued: falls back to the normal placeholder", () => {
		// (Moot in practice — the textarea is non-empty when queued — but the
		// builder shouldn't advertise queueing when the slot is full.)
		const p = buildComposerPlaceholder({
			...base,
			isStreaming: true,
			isQueued: true,
		});
		expect(p).not.toContain("Queue a message");
	});
});

// --- queue-vs-send default -------------------------------------------------

describe("shouldQueueOnSend (queue-is-default-while-streaming, T2)", () => {
	it("queues while streaming (isSending)", () => {
		expect(shouldQueueOnSend({ isSending: true })).toBe(true);
	});

	it("T2 — dispatches normally when idle (not isSending)", () => {
		expect(shouldQueueOnSend({ isSending: false })).toBe(false);
	});
});

// --- T6 / T7: hold-on-error and hold-on-cancel -----------------------------

/** NAIVE (buggy) flush: fires on ANY turn end while queued — ignores
 *  error/cancel. This is exactly what Decision 5 forbids. */
function naiveShouldFlush(p: FlushDecisionParams): boolean {
	return p.turnEnded && p.isQueued;
}

const completedTurn: FlushDecisionParams = {
	turnEnded: true,
	isQueued: true,
	hadError: false,
	wasCancelled: false,
};

describe("shouldFlushQueue — hold on error/cancel (T6, T7)", () => {
	it("flushes when the turn completes normally", () => {
		expect(shouldFlushQueue(completedTurn)).toBe(true);
	});

	it("T6 (reproduce) — NAIVE flush fires on an errored turn (the bug)", () => {
		const errored = { ...completedTurn, hadError: true };
		expect(naiveShouldFlush(errored)).toBe(true); // red: would auto-fire
		expect(shouldFlushQueue(errored)).toBe(false); // green: holds
	});

	it("T7 (reproduce) — NAIVE flush fires on a cancelled turn (the bug)", () => {
		const cancelled = { ...completedTurn, wasCancelled: true };
		expect(naiveShouldFlush(cancelled)).toBe(true); // red: would auto-fire
		expect(shouldFlushQueue(cancelled)).toBe(false); // green: holds
	});

	it("does not flush when nothing is queued", () => {
		expect(shouldFlushQueue({ ...completedTurn, isQueued: false })).toBe(
			false,
		);
	});

	it("does not flush mid-turn (turn has not ended)", () => {
		expect(shouldFlushQueue({ ...completedTurn, turnEnded: false })).toBe(
			false,
		);
	});
});

// --- T10 / T11: broadcast skip-guards --------------------------------------

function makeSendTarget(
	tabId: string,
	canSend: boolean,
	pending: boolean,
): BroadcastTarget {
	return {
		tabId,
		canSend: () => canSend,
		hasPendingQueue: () => pending,
	};
}

/** NAIVE broadcast-send selection: canSend() only, no pending-queue skip. */
function naiveSendTargets(handles: BroadcastTarget[]): BroadcastTarget[] {
	return handles.filter((h) => h.canSend());
}

describe("selectBroadcastSendTargets — skip pending-queue tabs (T10)", () => {
	it("T10 (reproduce) — NAIVE selection includes a queued tab (clobber)", () => {
		const queuedTab = makeSendTarget("b", true, true);
		const handles = [makeSendTarget("a", true, false), queuedTab];
		// red: the old canSend-only filter would send into the queued tab,
		// displacing its committed message (queue-of-one violated).
		expect(naiveSendTargets(handles)).toContain(queuedTab);
		// green: the guard skips it and reports it.
		const { targets, skippedQueued } = selectBroadcastSendTargets(handles);
		expect(targets.map((t) => t.tabId)).toEqual(["a"]);
		expect(skippedQueued.map((t) => t.tabId)).toEqual(["b"]);
	});

	it("does not report non-sendable tabs as skipped-for-queue", () => {
		const handles = [
			makeSendTarget("a", false, false), // not sendable (e.g. empty)
			makeSendTarget("b", true, false),
		];
		const { targets, skippedQueued } = selectBroadcastSendTargets(handles);
		expect(targets.map((t) => t.tabId)).toEqual(["b"]);
		expect(skippedQueued).toHaveLength(0);
	});
});

function makePromptTarget(tabId: string, pending: boolean) {
	return { tabId, hasPendingQueue: () => pending };
}

/** NAIVE broadcast-prompt selection: all non-source tabs, no skip. */
function naivePromptTargets<T extends { tabId: string }>(
	handles: T[],
	sourceTabId: string,
): T[] {
	return handles.filter((h) => h.tabId !== sourceTabId);
}

describe("selectBroadcastPromptTargets — skip pending-queue tabs (T11)", () => {
	it("T11 (reproduce) — NAIVE selection writes into a queued tab (clobber)", () => {
		const queuedTab = makePromptTarget("c", true);
		const handles = [
			makePromptTarget("a", false), // source
			makePromptTarget("b", false),
			queuedTab,
		];
		// red: old behavior overwrites the queued tab's composer.
		expect(naivePromptTargets(handles, "a")).toContain(queuedTab);
		// green: guard skips + reports it.
		const { targets, skippedQueued } = selectBroadcastPromptTargets(
			handles,
			"a",
		);
		expect(targets.map((t) => t.tabId)).toEqual(["b"]);
		expect(skippedQueued.map((t) => t.tabId)).toEqual(["c"]);
	});

	it("excludes the source tab from both lists", () => {
		const handles = [
			makePromptTarget("a", true), // source, also (irrelevantly) queued
			makePromptTarget("b", false),
		];
		const { targets, skippedQueued } = selectBroadcastPromptTargets(
			handles,
			"a",
		);
		expect(targets.map((t) => t.tabId)).toEqual(["b"]);
		expect(skippedQueued).toHaveLength(0); // source never reported
	});
});

// --- T12: broadcast-cancel independence (documented invariant) -------------

describe("broadcast-cancel does not flush queued messages (T12)", () => {
	it("a cancelled turn holds its queued message (Decision 5)", () => {
		// broadcast-cancel routes through cancelOperation per tab; the flush
		// gate then sees wasCancelled=true and holds.
		const afterBroadcastCancel: FlushDecisionParams = {
			turnEnded: true,
			isQueued: true,
			hadError: false,
			wasCancelled: true,
		};
		expect(shouldFlushQueue(afterBroadcastCancel)).toBe(false);
	});
});
