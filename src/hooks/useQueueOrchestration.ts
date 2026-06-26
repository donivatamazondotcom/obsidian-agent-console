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
}

export interface UseQueueOrchestrationReturn {
	/** True when a message is held — drives the locked-input UI + broadcast skip-guard. */
	isQueued: boolean;
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
	const stateRef = useRef(state);
	stateRef.current = state;

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
			}
		}
	}, []);

	return {
		isQueued: state.pending !== null,
		pending: state.pending,
		dispatch,
	};
}
