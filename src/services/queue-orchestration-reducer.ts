/**
 * queue-orchestration-reducer — the single owner of the pending-message slot
 * and the flush-vs-hold decision for the queue-next-message feature (#82).
 *
 * Why this exists (see [[ChatPanel lifecycle harness proposal]] and
 * [[Queue Orchestration Reducer]]): pending-message orchestration was spread
 * across two slots (`useMessageQueue` AND `useLazySession.queueRef`) and three
 * ChatPanel effects (connect-flush, busy-state, turn-end flush). The
 * load-bearing decision — at turn-end, dispatch the queued message through the
 * RAW send, never the re-enqueuing lazy wrapper — lived as a code COMMENT in a
 * ChatPanel `useEffect`, not as a tested invariant. Re-wire one `dispatch:`
 * argument back to the wrapper and every test stayed green while the Q4
 * silent-drop regression returned.
 *
 * This reducer folds that scattered logic into one pure
 * `(state, event) -> { state, effects[] }` fold. The crux: the flush is a
 * declarative `{ kind: "flushDispatch", message }` effect with **no
 * dispatch-choice field**. The adapter (ChatPanel) maps it to the raw send
 * unconditionally — there is structurally no way to route a flush through the
 * re-enqueuing wrapper, so the Q4 wiring blind spot is closed by construction.
 *
 * Convergence: same pure-decision + exhaustive + fast-check property-test
 * pattern as `decideSessionIntent` (utils/agent-switch.ts) and the
 * `tab-agent-invariant` validator. No React, no Obsidian — unit-testable in
 * isolation, and drivable from the `fc.commands` lifecycle model.
 */

import type { QueuedMessage } from "../types/chat";

// ============================================================================
// State
// ============================================================================

/**
 * The single pending-message slot (queue-of-one). `isQueued` is the selector
 * `pending !== null`; the composer-lock affordance is a render-time read of it,
 * NOT an effect. There is exactly one slot — `useLazySession.queueRef` is shed
 * (it was vestigial: ChatPanel wires `useLazySession` a no-op `sendPrompt`, so
 * its internal flush delivered nothing; only its acquisition-trigger side
 * effect was live, and that moves to the `acquire` effect here).
 */
export interface QueueOrchestrationState {
	/** The one pending message, or null when the slot is empty. */
	readonly pending: QueuedMessage | null;
}

export const initialQueueState: QueueOrchestrationState = { pending: null };

/** Selector: a message is currently held. Drives the composer lock + banner. */
export function isQueued(state: QueueOrchestrationState): boolean {
	return state.pending !== null;
}

// ============================================================================
// Events
// ============================================================================

/**
 * Every transition the queue orchestration can observe. The send-* events
 * carry the message; the lifecycle events carry the context the flush-vs-hold
 * decision needs (so the reducer never reads a racy React snapshot — `turnEnded`
 * is its own event, which is what catches Q4 by construction).
 */
export type QueueEvent =
	/** A send while the session is live and idle (no turn in flight). Not a
	 *  queue op — dispatches immediately. Included so the reducer is the sole
	 *  place a dispatch is decided. */
	| { type: "sendWhileReady"; message: QueuedMessage }
	/** A send while a turn is streaming. Hold as the one pending message;
	 *  flushes on `turnEnded`. */
	| { type: "sendWhileStreaming"; message: QueuedMessage }
	/** A send while connecting/idle (session not yet acquired). Hold + trigger
	 *  acquisition; flushes on `acquisitionComplete`. */
	| { type: "sendWhilePreReady"; message: QueuedMessage }
	/** The streaming turn ended (isSending true -> false). Flush the pending
	 *  message ONLY if the turn completed normally (Decision 5). */
	| { type: "turnEnded"; hadError: boolean; wasCancelled: boolean }
	/** Session acquisition reached `ready` ((connecting|idle)->ready). Flush
	 *  the pending message once a sessionId is committed (I69 guard). */
	| { type: "acquisitionComplete"; hasSessionId: boolean }
	/** Session acquisition failed (connecting->error). Hold the pending message;
	 *  the user's composer text is intact and they re-send to retry. */
	| { type: "acquisitionFailed" }
	/** User chose Edit on the queued banner: unlock the slot, KEEP composer text. */
	| { type: "editQueued" }
	/** User chose Delete on the queued banner: clear the slot AND the composer. */
	| { type: "deleteQueued" }
	/** Soft reload. `canResume` reflects SessionCapabilities.loadSession: when
	 *  true the same session resumes (transcript preserved) and the pending
	 *  message is kept (re-flushes on the next ready/turn-end). When false the
	 *  agent can't resume, so this degrades to `respawn` semantics for the slot. */
	| { type: "resume"; canResume: boolean }
	/** Restart agent / hard reload (respawn-lazy): fresh session, transcript
	 *  cleared. The pending message degrades to a preserved composer draft —
	 *  the slot is released, the composer text is kept, and it is NOT auto-fired
	 *  into the brand-new session. Matches the documented intent in
	 *  message-queue-logic's `shouldFlushQueue` ("degrades to a preserved draft
	 *  if the turn is later destroyed (close/reopen, restart)"). */
	| { type: "respawn" };

// ============================================================================
// Effects (declarative)
// ============================================================================

/**
 * Side effects the adapter (ChatPanel) must execute after applying a transition.
 *
 * `flushDispatch` deliberately carries ONLY the message — there is no field
 * naming a dispatch function or "raw vs wrapper" choice. The adapter maps it to
 * the raw send (`handleSendMessage`) unconditionally. This is the whole point:
 * the re-enqueuing lazy wrapper can no longer be wired into a flush, so a Q4
 * regression is structurally impossible rather than guarded by a comment.
 */
export type QueueEffect =
	/** Trigger lazy session acquisition (replaces the old
	 *  `lazySession.onSendClick` acquisition-trigger side effect). */
	| { kind: "acquire" }
	/** Dispatch this message via the RAW send. Always raw, by construction. */
	| { kind: "flushDispatch"; message: QueuedMessage }
	/** Clear the composer (text + attachments). Emitted with a flush so
	 *  draft-preservation observes the emptied composer, and on Delete. */
	| { kind: "clearComposer" };

export interface QueueReducerResult {
	readonly state: QueueOrchestrationState;
	readonly effects: readonly QueueEffect[];
}

// ============================================================================
// Reducer
// ============================================================================

const NO_EFFECTS: readonly QueueEffect[] = [];

/** Enqueue into the queue-of-one. Ignored (no overwrite) when the slot is full. */
function enqueue(
	state: QueueOrchestrationState,
	message: QueuedMessage,
	withAcquire: boolean,
): QueueReducerResult {
	// Queue-of-one guard: a second send while one is held is a no-op (the UI
	// also blocks it, but the reducer enforces the invariant regardless).
	if (state.pending !== null) {
		return { state, effects: NO_EFFECTS };
	}
	return {
		state: { pending: message },
		effects: withAcquire ? [{ kind: "acquire" }] : NO_EFFECTS,
	};
}

/** Consume the slot and emit the clear+flush effects, in that order. */
function flush(pending: QueuedMessage): QueueReducerResult {
	return {
		state: { pending: null },
		// clearComposer BEFORE flushDispatch so the emptied composer is what
		// draft-preservation persists (mirrors executeFlush's ordering).
		effects: [{ kind: "clearComposer" }, { kind: "flushDispatch", message: pending }],
	};
}

/** Release the slot but KEEP the composer text (degrade-to-draft / Edit). */
function degradeToDraft(): QueueReducerResult {
	return { state: { pending: null }, effects: NO_EFFECTS };
}

/**
 * Apply a queue-orchestration event. Total function — every event maps to a
 * known next state + effect list and never throws.
 */
export function queueOrchestrationReducer(
	state: QueueOrchestrationState,
	event: QueueEvent,
): QueueReducerResult {
	switch (event.type) {
		case "sendWhileReady":
			// Live idle session: dispatch now (raw). Not a queue op; slot stays
			// empty. Routing ready-sends through the reducer is optional for the
			// adapter, but keeps the reducer the single dispatch decision point.
			return {
				state,
				effects: [
					{ kind: "clearComposer" },
					{ kind: "flushDispatch", message: event.message },
				],
			};

		case "sendWhileStreaming":
			// Turn in flight: hold; flushes on turnEnded. No acquisition needed.
			return enqueue(state, event.message, /* withAcquire */ false);

		case "sendWhilePreReady":
			// Connecting/idle: hold + kick off acquisition; flushes on connect.
			return enqueue(state, event.message, /* withAcquire */ true);

		case "turnEnded": {
			const shouldFlush =
				state.pending !== null && !event.hadError && !event.wasCancelled;
			if (shouldFlush) {
				return flush(state.pending);
			}
			// Hold on error/cancel (Decision 5) — the message degrades to a
			// preserved draft on a later respawn/close, not into the dead turn.
			return { state, effects: NO_EFFECTS };
		}

		case "acquisitionComplete": {
			// Flush only once a sessionId is committed (I69): handleSendMessage
			// reads agent.session.sessionId, which must be set first.
			if (state.pending !== null && event.hasSessionId) {
				return flush(state.pending);
			}
			return { state, effects: NO_EFFECTS };
		}

		case "acquisitionFailed":
			// Hold: composer text is intact; user re-sends to retry.
			return { state, effects: NO_EFFECTS };

		case "editQueued":
			// Unlock the slot, keep the text so the user can modify + re-queue.
			return degradeToDraft();

		case "deleteQueued":
			// Discard: clear slot AND composer.
			return { state: { pending: null }, effects: [{ kind: "clearComposer" }] };

		case "resume":
			// Soft-reload. INTERIM (I103/(l)): degrade to a preserved draft
			// regardless of canResume. The designed "keep + re-flush on resume"
			// is blocked on the resume path signaling `ready` before the resumed
			// session can accept a prompt (the agent returns "Session not found");
			// until that resume-domain fix lands, soft-reload matches
			// restart/hard-reload. `canResume` is retained on the event for when
			// flush-on-resume becomes safe.
			return degradeToDraft();

		case "respawn":
			// Fresh session, transcript cleared. Degrade the pending message to a
			// preserved composer draft — do NOT auto-fire it into the new session.
			return degradeToDraft();
	}
}
