import { useEffect, useRef } from "react";
import type { ChatMessage } from "../types/chat";

export interface UseRestoredMessagesOptions {
	/**
	 * Restored message history for this tab, surfaced asynchronously by
	 * useTabPersistence (loaded from the per-session file on disk).
	 * `undefined` until the disk read resolves; may be empty.
	 */
	restoredMessages: ChatMessage[] | undefined;
	/**
	 * Whether the tab already has a live session. When true, restored
	 * messages are NOT applied — the active/new conversation takes
	 * precedence (clobber guard for the type-before-restore race).
	 */
	hasSession: boolean;
	/** Populate the message list. Wraps `agent.setMessagesFromLocal`. */
	apply: (messages: ChatMessage[]) => void;
}

/**
 * Seed a restored tab's message list from local history exactly once, when
 * the async-loaded `restoredMessages` arrive and the tab is still idle.
 *
 * Spec Decision #12 (I43). The guard (`hasSession` + applied-once ref)
 * ensures restored history can never overwrite an active or newly-created
 * conversation if the user typed before the disk read resolved.
 */
export function useRestoredMessages({
	restoredMessages,
	hasSession,
	apply,
}: UseRestoredMessagesOptions): void {
	const appliedRef = useRef(false);
	const applyRef = useRef(apply);
	applyRef.current = apply;

	useEffect(() => {
		if (appliedRef.current) return;
		if (hasSession) return;
		if (!restoredMessages || restoredMessages.length === 0) return;
		applyRef.current(restoredMessages);
		appliedRef.current = true;
	}, [restoredMessages, hasSession]);
}
