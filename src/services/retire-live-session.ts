/**
 * Executor for `decideSessionIntent`'s `retire` field (I210).
 *
 * The decision says WHAT happens to the old live session before a fresh chat
 * on the same process; this runs it. Kept out of the resolver so the decision
 * stays pure, and out of ChatPanel so the side effect is testable.
 *
 * A failed session/close falls back to a respawn: a leaked session (on Kiro
 * V2, a full MCP set) costs more than a one-to-two second respawn.
 *
 * I259: before any of that, `discardUnsent` deletes a session this process
 * created and never sent to (see `decideUnsentDiscard`). It runs for every
 * retire value, including `none` (an agent switch), and never throws.
 */

import type { SessionRetirement } from "../resolvers/agent-switch";
import type { UnsentDiscardDecision } from "../resolvers/unsent-discard";

export interface SessionRetirementPort {
	/** session/close the tab's live session on the current process. */
	closeLiveSession: () => Promise<void>;
	/** Tear the subprocess down (disconnect); the next acquisition re-initializes. */
	respawn: () => Promise<void>;
	/** Logger hook for the close-failed fallback. */
	warn: (message: string, error: unknown) => void;
	/**
	 * I259: delete a never-sent session first. Bound to a decision taken
	 * before the caller cleared any state; resolves even when the delete
	 * fails.
	 */
	discardUnsent?: () => Promise<unknown>;
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
	await port.discardUnsent?.();
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

// ============================================================================
// I259: delete a never-sent session
// ============================================================================

/** Upper bound on a `session/delete`: measured 3–72 ms on Kiro V3 and Claude. */
export const UNSENT_DELETE_TIMEOUT_MS = 1000;

export interface UnsentDiscardPort {
	/** AcpClient.isUnsentSession, re-checked right before the request. */
	isUnsentSession: (sessionId: string) => boolean;
	/** AcpClient.deleteUnsentSession; rejects on failure. */
	deleteSession: (sessionId: string) => Promise<void>;
	warn: (message: string, error: unknown) => void;
}

export type UnsentDiscardOutcome = "none" | "deleted" | "failed";

/**
 * Run a `decideUnsentDiscard` decision. Never throws and never waits longer
 * than `timeoutMs`: a failed or slow delete is logged and retirement goes on.
 * No notice, no retry.
 */
export async function discardUnsentSession(
	decision: UnsentDiscardDecision,
	port: UnsentDiscardPort,
	timeoutMs: number = UNSENT_DELETE_TIMEOUT_MS,
): Promise<UnsentDiscardOutcome> {
	if (decision.kind !== "delete") return "none";
	// A send that slipped in since the snapshot makes it a real session.
	if (!port.isUnsentSession(decision.sessionId)) return "none";
	let timer: number | undefined;
	try {
		await Promise.race([
			port.deleteSession(decision.sessionId),
			new Promise<never>((_, reject) => {
				timer = window.setTimeout(
					() => reject(new Error("session/delete timed out")),
					timeoutMs,
				);
			}),
		]);
		return "deleted";
	} catch (error) {
		port.warn("[I259] session/delete failed", error);
		return "failed";
	} finally {
		window.clearTimeout(timer);
	}
}

/** The AcpClient surface the I259 discard needs. */
export interface UnsentDiscardClient {
	isUnsentSession: (sessionId: string) => boolean;
	deleteUnsentSession: (sessionId: string) => Promise<void>;
}

export function unsentDiscardPortFor(
	client: UnsentDiscardClient,
	warn: (message: string, error: unknown) => void,
): UnsentDiscardPort {
	return {
		isUnsentSession: (id) => client.isUnsentSession(id),
		deleteSession: (id) => client.deleteUnsentSession(id),
		warn,
	};
}

/**
 * Tab close (I259): delete a never-sent session, then kill the tab's agent
 * process. Called only from the explicit close handlers with a decision they
 * took before removing the tab; view close and unmount pass `keep`, because
 * their tab state survives and comes back on restore.
 */
export async function retireClosedTabClient(
	client: UnsentDiscardClient & { disconnect: () => Promise<void> },
	decision: UnsentDiscardDecision,
	warn: (message: string, error: unknown) => void,
): Promise<void> {
	await discardUnsentSession(decision, unsentDiscardPortFor(client, warn));
	await client.disconnect();
}
