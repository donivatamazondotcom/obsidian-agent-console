/**
 * What kind of first message is this send? (pure, total — I241, I265)
 *
 * Two questions hide in "first message", and a fallback pulls them apart:
 *
 * - First message of the CHAT turns on the chat-start extras: the title rubric
 *   (and title head buffer), the auto-default context note and the
 *   first-message history save. A tab that continues an existing session
 *   (restored from history, or forked from one) is never on its first message,
 *   even while its transcript is still empty because the agent's replay
 *   arrives during the load that this very send triggers (I241).
 * - First message of this AGENT SESSION turns on the system instruction
 *   (`<obsidian_system_instruction>`: conventions, vault paths, reply
 *   language). After a lossy fallback (failed load, engine change, empty load,
 *   soft reload fresh, local fork) the chat continues on screen but the agent
 *   session is brand new, so it needs the instruction once (I265) without a
 *   new title or a second history record.
 *
 * `freshSessionAfterFallback` comes from the fallback flag I246 already sets
 * (`onSessionFallback`); it outranks `continuesExistingSession`, because a
 * restored tab that loaded and then soft-reloads into a fresh session keeps
 * its restored id. Never reads the agent id.
 */
export interface FirstMessageInput {
	/** Messages currently in the tab's transcript. */
	transcriptLength: number;
	/** The tab is bound to (or about to load) a session that already exists. */
	continuesExistingSession: boolean;
	/** The bound session was started by a fallback and hasn't been sent to yet. */
	freshSessionAfterFallback: boolean;
}

export type FirstMessageKind = "new-chat" | "new-agent-session" | "continuing";

export function decideFirstMessage(input: FirstMessageInput): FirstMessageKind {
	if (input.transcriptLength === 0 && !input.continuesExistingSession) {
		return "new-chat";
	}
	if (input.freshSessionAfterFallback) return "new-agent-session";
	return "continuing";
}

/** The system instruction goes on the first message of every agent session. */
export function sendsSystemInstruction(kind: FirstMessageKind): boolean {
	return kind !== "continuing";
}

/** Title rubric, auto-default note and first-message save: a new chat only. */
export function isFirstMessageOfChat(kind: FirstMessageKind): boolean {
	return kind === "new-chat";
}
