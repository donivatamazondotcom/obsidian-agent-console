import { useEffect, useRef } from "react";
import type { ChatMessage } from "../types/chat";
import type { ContextNote } from "../types/context";

export interface UseRestoredMessagesOptions {
	/**
	 * Restored message history for this tab, surfaced asynchronously by
	 * useTabPersistence (loaded from the per-session file on disk).
	 * `undefined` until the disk read resolves; may be empty.
	 */
	restoredMessages: ChatMessage[] | undefined;
	/**
	 * Restored crystallized context notes for this tab (I61), from the same
	 * per-session file. Applied under the same guard as messages so the
	 * context strip is rehydrated on startup auto-restore, not just on
	 * history-modal restore. `undefined` until resolved; may be empty.
	 */
	restoredContextNotes?: ContextNote[] | undefined;
	/**
	 * Whether the tab already has a live session. When true, restored
	 * state is NOT applied — the active/new conversation takes precedence
	 * (clobber guard for the type-before-restore race).
	 */
	hasSession: boolean;
	/** Populate the message list. Wraps `agent.setMessagesFromLocal`. */
	apply: (messages: ChatMessage[]) => void;
	/** Populate the context strip. Wraps `contextNotes.replace` (I61). */
	applyContextNotes?: (notes: ContextNote[]) => void;
}

/**
 * Seed a restored tab's message list and context strip from local state
 * exactly once, when the async-loaded values arrive and the tab is still
 * idle.
 *
 * Spec Decision #12 (I43) for messages; I61 extends the same guard to
 * context notes so the two restore paths (history-modal restore and
 * startup auto-restore) stay consistent. The guard (`hasSession` +
 * applied-once ref) ensures restored state can never overwrite an active
 * or newly-created conversation if the user typed before the disk read
 * resolved.
 */
export function useRestoredMessages({
	restoredMessages,
	restoredContextNotes,
	hasSession,
	apply,
	applyContextNotes,
}: UseRestoredMessagesOptions): void {
	const appliedRef = useRef(false);
	const applyRef = useRef(apply);
	applyRef.current = apply;
	const applyNotesRef = useRef(applyContextNotes);
	applyNotesRef.current = applyContextNotes;

	useEffect(() => {
		if (appliedRef.current) return;
		if (hasSession) return;
		const hasMsgs = !!restoredMessages && restoredMessages.length > 0;
		const hasNotes =
			!!restoredContextNotes && restoredContextNotes.length > 0;
		if (!hasMsgs && !hasNotes) return;
		if (hasMsgs) applyRef.current(restoredMessages);
		if (hasNotes && applyNotesRef.current) {
			applyNotesRef.current(restoredContextNotes);
		}
		appliedRef.current = true;
	}, [restoredMessages, restoredContextNotes, hasSession]);
}
