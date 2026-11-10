/**
 * Whether a tab that is losing its live session keeps the id for its next
 * connect (I237, I318).
 *
 * Kept when there is something to resume: a transcript on screen, or an id
 * the lazy owner still holds (restored from disk, kept by an earlier release
 * or reload, and not cleared by a reset). Otherwise the id is dropped, so the
 * next send starts a plain new chat: an empty session has nothing to load,
 * and keeping it would make the first message read as "continuing".
 *
 * Read from live owner state, never the mount-time restored id: New chat and
 * hard reload reset the owner but not that prop.
 *
 * Callers: idle release (ChatPanel) and a failed bound reload
 * (`useLazySession.reloadNow`).
 */
export interface KeepSessionIdInput {
	/** Messages are on screen. */
	hasMessages: boolean;
	/** The lazy owner holds a kept id (`continuesExistingSession`). */
	holdsKeptId: boolean;
}

export function decideKeepSessionId(input: KeepSessionIdInput): boolean {
	return input.hasMessages || input.holdsKeptId;
}
