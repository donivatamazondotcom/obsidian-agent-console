import type { SessionFallbackReason } from "./session-engine";

/**
 * I282: why a kept session id couldn't be reopened.
 *
 * - `initialize`: the agent process never started.
 * - `rejected`: the agent answered the load with "no such session".
 * - `empty`: the load succeeded but replayed no conversation where one was
 *   expected (Kiro V3, I264).
 * - `engine-changed`: the chat ran on Kiro V3 and the agent now runs V2 (D2);
 *   the id was never sent.
 * - `engine-changed-old-cli`: the same, because the agent follows the
 *   Default engine and the kiro-cli is too old for V3 (I302).
 * - `transport`: the request got no real answer (closed, timed out).
 */
export type RestoreFailureKind =
	| "initialize"
	| "rejected"
	| "empty"
	| "engine-changed"
	| "engine-changed-old-cli"
	| "transport";

export type RestoreFailureDecision =
	/** Nothing local to carry over and the agent doesn't have it. */
	| { kind: "gone" }
	/** Nothing local to carry over and the agent couldn't be asked. */
	| { kind: "connect-failed" }
	/** Start a new session and send the on-screen transcript (I246). */
	| { kind: "fallback"; reason: SessionFallbackReason };

/**
 * What the lazy owner does after a restored or released tab's load failed.
 *
 * A row opened from the Agent view with no local record has nothing on
 * screen until a load succeeds, so a fallback would start empty while the
 * notice claims a transcript (I282). Such a row is `gone` when the agent
 * rejected or emptily loaded it, and `connect-failed` when it was never
 * asked. Any tab with a local record (the I269 record binding) or a
 * transcript on screen keeps the fallback. An engine change always falls
 * back: the session still exists on the other engine.
 *
 * Pure and total; reads only the record binding, the screen and the failure
 * kind, never the agent id.
 */
export function decideRestoreFailure(input: {
	hasLocalRecord: boolean;
	haveLocalHistory: boolean;
	failure: RestoreFailureKind | undefined;
}): RestoreFailureDecision {
	const reason: SessionFallbackReason = "unavailable";
	const keepsFallback = input.hasLocalRecord || input.haveLocalHistory;
	switch (input.failure) {
		case "engine-changed":
		case "engine-changed-old-cli":
			// The session still exists on the other engine: always fall back.
			return { kind: "fallback", reason: input.failure };
		case "rejected":
		case "empty":
			return keepsFallback ? { kind: "fallback", reason } : { kind: "gone" };
		case "initialize":
		case "transport":
		case undefined:
			return keepsFallback
				? { kind: "fallback", reason }
				: { kind: "connect-failed" };
	}
}
