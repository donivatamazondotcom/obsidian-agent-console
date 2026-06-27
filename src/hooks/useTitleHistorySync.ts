import * as React from "react";
const { useEffect, useRef } = React;

/**
 * I112 — propagate the resolved AI session title to the session-history record.
 *
 * The F03 AI title (`suggestedTitle`) updates the tab label via
 * `onLabelChange → setTabLabel`, but the session-history record's title was
 * only ever set from the first-message text (`saveSessionLocally`) and
 * otherwise updated solely by the history modal's manual rename. So the
 * history pane kept showing the first message while the tab showed the AI
 * title. This hook closes that gap: when the AI title resolves, it also calls
 * `updateSessionTitle` so the history record matches the tab label.
 *
 * Behavior:
 * - De-dupes repeat fires of the same title; resets when the title clears
 *   (new chat) so a fresh conversation can sync a new title — mirrors the
 *   label-swap effect's `lastSuggestedTitleRef`.
 * - No-ops until a `sessionId` exists. `sessionId` is in the dependency list,
 *   so if the title resolves before the session id commits, the sync fires as
 *   soon as the id arrives.
 * - Scope: the AI/auto title only. The interim prompt-derived label is NOT
 *   propagated (the history record already carries the first-message text).
 *   Manual tab-bar rename → history is a separate gap, not handled here.
 *
 * Extracted as its own hook (not inlined in ChatPanel) so the wiring is
 * unit-testable in isolation with a spy — per the "test the LIVE wiring, not
 * just the pure function" lesson from the F03 work.
 */
export function useTitleHistorySync(args: {
	suggestedTitle: string | null;
	sessionId: string | null | undefined;
	cwd: string;
	updateSessionTitle: (
		sessionId: string,
		title: string,
		cwd: string,
	) => void | Promise<void>;
}): void {
	const { suggestedTitle, sessionId, cwd, updateSessionTitle } = args;
	const lastSyncedRef = useRef<string | null>(null);

	useEffect(() => {
		if (!suggestedTitle) {
			lastSyncedRef.current = null;
			return;
		}
		if (suggestedTitle === lastSyncedRef.current) return;
		if (!sessionId) return;
		lastSyncedRef.current = suggestedTitle;
		void updateSessionTitle(sessionId, suggestedTitle, cwd);
	}, [suggestedTitle, sessionId, cwd, updateSessionTitle]);
}
