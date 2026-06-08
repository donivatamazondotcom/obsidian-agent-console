import { useEffect, useRef } from "react";
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
 *    latest pending snapshot is written synchronously, so the in-flight
 *    turn is not lost.
 *
 * No-ops while `sessionId` is null or `messages` is empty.
 */
export function useDebouncedSessionSave(
	sessionId: string | null,
	messages: ChatMessage[],
	contextNotes: ContextNote[],
	save: (
		sessionId: string,
		messages: ChatMessage[],
		contextNotes: ContextNote[],
	) => void,
	debounceMs = 1000,
	maxWaitMs = 1000,
): void {
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

	// Stable flush: write the latest pending snapshot iff dirty.
	const flushRef = useRef<() => void>(() => {});
	flushRef.current = () => {
		if (timerRef.current !== null) {
			window.clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		firstPendingAtRef.current = null;
		if (!dirtyRef.current) return;
		const pending = latestRef.current;
		if (pending) {
			saveRef.current(pending.sessionId, pending.messages, contextNotesRef.current);
			dirtyRef.current = false;
		}
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
		timerRef.current = window.setTimeout(() => flushRef.current(), delay);

		return () => {
			if (timerRef.current !== null) {
				window.clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [messages, sessionId, debounceMs, maxWaitMs]);

	// Unmount-flush: write the pending tail on teardown (reload / quit).
	useEffect(() => {
		return () => flushRef.current();
	}, []);
}
