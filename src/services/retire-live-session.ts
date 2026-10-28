/**
 * Executor for `decideSessionIntent`'s `retire` field (I210).
 *
 * The decision says WHAT happens to the old live session before a fresh chat
 * on the same process; this runs it. Kept out of the resolver so the decision
 * stays pure, and out of ChatPanel so the side effect is testable.
 *
 * A failed session/close falls back to a respawn: a leaked session (on Kiro
 * V2, a full MCP set) costs more than a one-to-two second respawn.
 */

import type { SessionRetirement } from "../resolvers/agent-switch";

export interface SessionRetirementPort {
	/** session/close the tab's live session on the current process. */
	closeLiveSession: () => Promise<void>;
	/** Tear the subprocess down (disconnect); the next acquisition re-initializes. */
	respawn: () => Promise<void>;
	/** Logger hook for the close-failed fallback. */
	warn: (message: string, error: unknown) => void;
}

export type SessionRetirementOutcome =
	| "none"
	| "closed"
	| "respawned"
	| "respawned-after-close-failed";

export async function retireLiveSession(
	retire: SessionRetirement,
	port: SessionRetirementPort,
): Promise<SessionRetirementOutcome> {
	switch (retire) {
		case "none":
			return "none";
		case "respawn":
			await port.respawn();
			return "respawned";
		case "close":
			try {
				await port.closeLiveSession();
				return "closed";
			} catch (error) {
				port.warn(
					"session/close failed; respawning the agent instead",
					error,
				);
				await port.respawn();
				return "respawned-after-close-failed";
			}
	}
}
