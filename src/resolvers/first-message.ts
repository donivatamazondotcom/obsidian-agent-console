/**
 * Is this send the first message of its session? (pure, total — I241)
 *
 * "First message" turns on the first-message extras: the system instruction,
 * the title rubric (and title head buffer), the auto-default context note and
 * the first-message history save. It is a property of the SESSION, not of the
 * transcript on screen. A tab that continues an existing session (restored
 * from history, or forked from one) is never on its first message, even while
 * its transcript is still empty because the agent's replay arrives during the
 * load that this very send triggers.
 */
export interface FirstMessageInput {
	/** Messages currently in the tab's transcript. */
	transcriptLength: number;
	/** The tab is bound to (or about to load) a session that already exists. */
	continuesExistingSession: boolean;
}

export function isFirstMessageOfSession(input: FirstMessageInput): boolean {
	return input.transcriptLength === 0 && !input.continuesExistingSession;
}
