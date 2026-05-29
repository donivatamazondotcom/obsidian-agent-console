import type { SessionResult } from "../types/session";

export type SessionAcquisitionResult =
	| { ok: true; sessionId: string }
	| { ok: false; error: Error };

export interface LoadExistingSessionFlowArgs {
	sessionId: string;
	cwd: string;
	/**
	 * Whether local history is already displayed (seeded on mount). When
	 * true, the agent's `session/update` replay is suppressed so it does
	 * not duplicate the visible history; when false (type-before-restore
	 * race) the replay is allowed through as the sole source. (I43 #12)
	 */
	haveLocalHistory: boolean;
	loadSession: (sessionId: string, cwd: string) => Promise<SessionResult>;
	onLoaded: (result: SessionResult) => void;
	setIgnoreUpdates: (ignore: boolean) => void;
}

/**
 * Resume an existing session on first-keystroke reconnect (I44), with
 * conditional replay suppression (I43 Decision #12). Pure orchestration —
 * all I/O is injected so it is unit-testable without rendering ChatPanel.
 *
 * Mirrors the canonical `useSessionHistory.restoreSession` ignore-updates
 * pattern: suppress before `loadSession`, release in `finally`.
 */
export async function loadExistingSessionFlow(
	args: LoadExistingSessionFlowArgs,
): Promise<SessionAcquisitionResult> {
	const { sessionId, cwd, haveLocalHistory, loadSession, onLoaded, setIgnoreUpdates } =
		args;
	if (haveLocalHistory) setIgnoreUpdates(true);
	try {
		const result = await loadSession(sessionId, cwd);
		onLoaded(result);
		return { ok: true, sessionId: result.sessionId };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err : new Error(String(err)),
		};
	} finally {
		if (haveLocalHistory) setIgnoreUpdates(false);
	}
}
