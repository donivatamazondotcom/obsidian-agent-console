/**
 * useQueueOrchestration — the thin React adapter over the pure
 * `queueOrchestrationReducer` (#82). It owns the single pending-message slot
 * and turns reducer effects into ChatPanel-scoped side effects.
 *
 * Replaces `useMessageQueue` as the slot owner. The key property: `dispatch`
 * reads the slot from a ref (`stateRef.current`), not from rendered state, so
 * the queue decision is never made against a stale React snapshot — the
 * cross-layer commit-ordering race (Q4) cannot reach the slot. The flush is
 * executed via the injected `flushDispatch` handler, which ChatPanel wires to
 * the RAW send unconditionally (the reducer's `flushDispatch` effect carries no
 * dispatch-choice, so the re-enqueuing wrapper can never be wired in).
 *
 * See [[Queue Orchestration Reducer]] and [[ChatPanel lifecycle harness proposal]].
 */

import { useCallback, useRef, useState } from "react";
import {
	queueOrchestrationReducer,
	initialQueueState,
	type QueueEvent,
	type QueueOrchestrationState,
} from "../services/queue-orchestration-reducer";
import type { QueuedMessage } from "../types/chat";

/** ChatPanel-supplied handlers that execute the reducer's declarative effects. */
export interface QueueEffectHandlers {
	/** Trigger lazy session acquisition so the connect-flush can deliver. */
	acquire: () => void;
	/** Dispatch a message via the RAW send path (handleSendMessage). Always raw. */
	flushDispatch: (message: QueuedMessage) => void;
	/** Clear the composer (text + attachments). */
	clearComposer: () => void;
	/** #81: cancel the in-flight turn (RAW stop) so steer can redirect on turn-end. */
	cancelTurn: () => void;
}

export interface UseQueueOrchestrationReturn {
	/** True when a message is held — drives the locked-input UI + broadcast skip-guard. */
	isQueued: boolean;
	/** #81: true when the held message is a steer (cancel-then-redirect in flight). */
	isSteering: boolean;
	/** The pending message, or null. */
	pending: QueuedMessage | null;
	/** Feed an event to the reducer; applies the next state and runs its effects. */
	dispatch: (event: QueueEvent) => void;
}

export function useQueueOrchestration(
	handlers: QueueEffectHandlers,
): UseQueueOrchestrationReturn {
	const [state, setState] = useState<QueueOrchestrationState>(initialQueueState);

	// The slot is read from a ref so `dispatch` decides against the committed
	// slot value, never a stale render snapshot — this is what keeps the queue
	// decision immune to the Q4 commit-ordering race.
	//
	// The ref is **dispatch-authoritative**: it is initialized once and
	// thereafter advanced ONLY inside `dispatch` (below). It is deliberately
	// NOT re-synced from `state` on every render (`stateRef.current = state`).
	// That re-sync was the #81 steer double-send bug: the steer sequence
	// (cancel → flush → send → a rapid second turn-end edge) fires a second
	// `turnEnded` while flush #1's `setState(pending:null)` is still mid-commit;
	// an intervening render (from an unrelated state change, e.g. isSending
	// toggling) carries the STALE `state` (the un-flushed slot), so the resync
	// clobbered the ref back to the consumed message and the second `turnEnded`
	// flushed it again → duplicate send. Since `state` only ever changes via
	// `setState` inside `dispatch` — which also advances this ref — the ref is
	// always current and the resync was redundant as well as harmful.
	const stateRef = useRef(state);

	// Stable ref to the latest handlers so `dispatch` keeps a stable identity
	// (it's passed through effect deps and callbacks across the chat panel).
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;

	const dispatch = useCallback((event: QueueEvent) => {
		const result = queueOrchestrationReducer(stateRef.current, event);
		stateRef.current = result.state;
		setState(result.state);
		for (const effect of result.effects) {
			switch (effect.kind) {
				case "acquire":
					handlersRef.current.acquire();
					break;
				case "flushDispatch":
					handlersRef.current.flushDispatch(effect.message);
					break;
				case "clearComposer":
					handlersRef.current.clearComposer();
					break;
				case "cancelTurn":
					handlersRef.current.cancelTurn();
					break;
			}
		}
	}, []);

	return {
		isQueued: state.pending !== null,
		isSteering: state.pending !== null && (state.steering ?? false),
		pending: state.pending,
		dispatch,
	};
}
