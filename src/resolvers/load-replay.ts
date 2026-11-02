/**
 * I264: did a successful `session/load` actually reopen the conversation?
 *
 * Kiro V3 answers `session/load` for an id it never created with success and
 * an empty session (probed 2026-11-02: only session info, commands and config
 * updates, no conversation). V2, Claude Code and Codex reject such a load, so
 * they never reach this check. Every conversation chunk of a real load
 * arrives before the response, and the `acp/` edge counts them
 * (`SessionResult.replayedConversationUpdates`).
 *
 * - `empty`: nothing replayed while a transcript is on screen. The agent
 *   doesn't have this chat; the caller treats it as a failed load.
 * - `loaded`: anything else. With no transcript on screen an empty replay is
 *   correct (an empty chat). A missing count (resume, or a path that doesn't
 *   count) can't be judged, so it loads as before.
 *
 * Pure and total; reads only normalized data, never the agent id.
 */
export type LoadReplayDecision = { kind: "loaded" } | { kind: "empty" };

export function decideLoadReplay(input: {
	replayedConversationUpdates: number | undefined;
	haveLocalHistory: boolean;
}): LoadReplayDecision {
	if (input.haveLocalHistory && input.replayedConversationUpdates === 0) {
		return { kind: "empty" };
	}
	return { kind: "loaded" };
}
