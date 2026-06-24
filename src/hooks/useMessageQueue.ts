/**
 * useMessageQueue — per-tab "queue exactly one next message" slot (#82).
 *
 * While the agent is streaming a reply, the user can queue their next message;
 * it auto-sends the moment the turn completes and the session returns to ready.
 *
 * Design invariants (see [[Agent Console Queue Next Message]]):
 * - **Queue-of-one, modelled as a list capped at length 1.** The cap-1 list
 *   future-proofs a later move to FIFO-N (a cap change + a reorder affordance,
 *   not a rearchitecture) without changing the v1 contract.
 * - **`isQueued` is a runtime-only flag — never persisted.** The composer text
 *   remains the single source of truth and is persisted for free by the
 *   per-tab draft-preservation feature, so a pending message degrades to a
 *   plain preserved draft across any turn-destroying boundary (close/reopen,
 *   restart).
 * - **The slot lives in React state** (not a ref) because `isQueued` drives the
 *   locked-input UI and the broadcast skip-guard — both must re-render on
 *   enqueue / consume / clear.
 *
 * The hook is deliberately pure and host-agnostic: it owns only the slot, not
 * the send path, the composer, or the completion detection. ChatPanel wires
 * those in.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { QueuedMessage } from "../types/chat";

/** Maximum queued messages. v1 = 1; bump (plus a reorder UI) for FIFO-N. */
export const MESSAGE_QUEUE_CAP = 1;

export interface UseMessageQueueReturn {
	/** True when a message is queued (drives the locked-input UI + skip-guard). */
	isQueued: boolean;
	/** The head of the queue, or null. For display + flush. */
	queued: QueuedMessage | null;
	/**
	 * Queue a message. No-op when the queue is already full (queue-of-one) —
	 * the locked input structurally prevents a second queue at the UI layer;
	 * this is the defensive backstop so a stray programmatic enqueue can never
	 * silently displace a committed message.
	 * @returns true if the message was queued, false if rejected (full).
	 */
	enqueue: (message: QueuedMessage) => boolean;
	/**
	 * Pop and return the head, clearing the slot. Used by the flush effect on
	 * turn completion. Returns null when empty.
	 */
	consume: () => QueuedMessage | null;
	/**
	 * Clear the slot without sending. Backs both Edit (caller keeps the
	 * composer text + refocuses to re-queue) and Cancel (caller clears the
	 * composer). The composer-side handling is the caller's responsibility.
	 */
	clear: () => void;
}

export function useMessageQueue(
	cap: number = MESSAGE_QUEUE_CAP,
): UseMessageQueueReturn {
	// Modelled as a list capped at `cap` (= 1 in v1) per the spec's
	// future-proofing decision, even though only the head is used today.
	// State drives the re-render (locked-input UI + skip-guard); the ref
	// mirror gives enqueue/consume reliable *synchronous* return values
	// without depending on a functional-updater side effect (which React 18
	// StrictMode double-invokes).
	const [queue, setQueue] = useState<QueuedMessage[]>([]);
	const queueRef = useRef<QueuedMessage[]>(queue);
	queueRef.current = queue;

	const enqueue = useCallback(
		(message: QueuedMessage): boolean => {
			if (queueRef.current.length >= cap) return false; // full — reject
			const next = [...queueRef.current, message];
			queueRef.current = next;
			setQueue(next);
			return true;
		},
		[cap],
	);

	const consume = useCallback((): QueuedMessage | null => {
		if (queueRef.current.length === 0) return null;
		const head = queueRef.current[0];
		const next = queueRef.current.slice(1);
		queueRef.current = next;
		setQueue(next);
		return head;
	}, []);

	const clear = useCallback(() => {
		if (queueRef.current.length === 0) return;
		queueRef.current = [];
		setQueue([]);
	}, []);

	return useMemo(
		() => ({
			isQueued: queue.length > 0,
			queued: queue[0] ?? null,
			enqueue,
			consume,
			clear,
		}),
		[queue, enqueue, consume, clear],
	);
}
