import { useCallback, useEffect, useRef } from "react";
import type { ChatMessage } from "../types/chat";
import type { ContextNote } from "../types/context";

/**
 * Debounced incremental save of session message history (I48).
 *
 * Extracted from ChatPanel so the save lifecycle is unit-testable, and
 * hardened against mid-stream reload loss:
 *
 *  - **Trailing debounce** (`debounceMs`): coalesces token-by-token
 *    `messages` updates into ~one write per quiet window.
 *  - **Max-wait** (`maxWaitMs`): clamps the debounce so a save still fires
 *    during *continuous* streaming (where every chunk would otherwise reset
 *    the timer and starve it). Guarantees a checkpoint at least every
 *    `maxWaitMs` while messages keep changing.
 *  - **Unmount-flush**: on teardown (plugin reload / Obsidian quit) the
 *    latest pending snapshot is written, so the in-flight turn is not lost.
 *  - **Awaited teardown flush** (I193): `flushPending()` returns a promise
 *    that resolves only after the underlying async write settles. The old
 *    unmount-flush fired `save()` fire-and-forget, so `ChatView.onClose`
 *    could resolve (and the app quit) before the message-file write landed —
 *    losing the tail even though tab-state (which HAS an awaited `flushSave`)
 *    survived. `flushPending` gives the teardown path the same awaitable
 *    durability the tab-state flush already had.
 *
 * No-ops while `sessionId` is null or `messages` is empty.
 *
 * @returns `{ flushPending }` — an awaitable flush for teardown callers.
 */
export function useDebouncedSessionSave(
	sessionId: string | null,
	messages: ChatMessage[],
	contextNotes: ContextNote[],
	save: (
		sessionId: string,
		messages: ChatMessage[],
		contextNotes: ContextNote[],
	) => void | Promise<void>,
	debounceMs = 1000,
	maxWaitMs = 1000,
): { flushPending: () => Promise<void> } {
	const saveRef = useRef(save);
	saveRef.current = save;
	const contextNotesRef = useRef(contextNotes);
	contextNotesRef.current = contextNotes;

	const latestRef = useRef<{
		sessionId: string;
		messages: ChatMessage[];
	} | null>(null);
	const dirtyRef = useRef(false);
	const timerRef = useRef<number | null>(null);
	const firstPendingAtRef = useRef<number | null>(null);
	// Latest in-flight write promise. An awaited flush (teardown) waits on this
	// so the disk write settles before onClose resolves / the app quits (I193).
	const lastWriteRef = useRef<Promise<void>>(Promise.resolve());

	// Stable flush: write the latest pending snapshot iff dirty. Returns a
	// promise that resolves when the underlying write settles, so a teardown
	// flush can await durability (I193). When nothing is dirty it resolves on
	// the last write already scheduled (no-op flushes stay awaitable).
	const flushRef = useRef<() => Promise<void>>(() => Promise.resolve());
	flushRef.current = () => {
		if (timerRef.current !== null) {
			window.clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		firstPendingAtRef.current = null;
		if (!dirtyRef.current) return lastWriteRef.current;
		const pending = latestRef.current;
		if (pending) {
			dirtyRef.current = false;
			// Normalize void | Promise<void> to an awaitable so teardown can
			// wait for the write regardless of the save's return type.
			lastWriteRef.current = Promise.resolve(
				saveRef.current(
					pending.sessionId,
					pending.messages,
					contextNotesRef.current,
				),
			);
		}
		return lastWriteRef.current;
	};

	useEffect(() => {
		if (!sessionId || messages.length === 0) return;
		latestRef.current = { sessionId, messages };
		dirtyRef.current = true;

		const now = Date.now();
		if (firstPendingAtRef.current === null) firstPendingAtRef.current = now;
		const waited = now - firstPendingAtRef.current;
		// Clamp so a save fires within maxWaitMs even if chunks keep arriving.
		const delay = Math.max(0, Math.min(debounceMs, maxWaitMs - waited));

		if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		timerRef.current = window.setTimeout(() => {
			void flushRef.current();
		}, delay);

		return () => {
			if (timerRef.current !== null) {
				window.clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [messages, sessionId, debounceMs, maxWaitMs]);

	// Unmount-flush: write the pending tail on teardown (reload / quit).
	useEffect(() => {
		return () => {
			void flushRef.current();
		};
	}, []);

	// Awaitable flush for teardown (ChatView.onClose) — resolves after the
	// pending write settles, mirroring the tab-state flushSave (I193).
	const flushPending = useCallback(() => flushRef.current(), []);

	return { flushPending };
}
