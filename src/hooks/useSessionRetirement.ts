/**
 * useSessionRetirement — the panel-side owner of "retire this tab's session"
 * (I259, with I210's close/respawn).
 *
 * `snapshot()` decides, synchronously and from refs only, whether the tab's
 * live session is a never-sent one to delete. Callers take it at the top of
 * a handler, before clearing messages or rebinding the agent, and hand it to
 * `retire` (New chat, agent switch, hard reload), `discard` (idle release) or
 * the tab-close path. It reads refs only because the tab-close path reaches
 * it through a registered tab handle that doesn't re-render with ChatPanel.
 *
 * Spec: [[I259 Empty Kiro chats pile up in the Agent view]] § Spec 4.
 */
import { useMemo, useRef } from "react";

import type { SessionRetirement } from "../resolvers/agent-switch";
import {
	decideUnsentDiscard,
	type UnsentDiscardDecision,
} from "../resolvers/unsent-discard";
import {
	discardUnsentSession,
	retireLiveSession,
	unsentDiscardPortFor,
	type SessionRetirementOutcome,
	type SessionRetirementPort,
	type UnsentDiscardClient,
	type UnsentDiscardOutcome,
} from "../services/retire-live-session";
import type { AgentCapabilities } from "../types/session";

export interface SessionRetirementClient extends UnsentDiscardClient {
	getInitializeResult: () => { capabilities: AgentCapabilities } | null;
}

export interface UseSessionRetirementArgs {
	client: SessionRetirementClient;
	/** The tab's live agent session id, read at call time. */
	getSessionId: () => string | null;
	/** Messages on screen, read at call time. */
	getMessageCount: () => number;
	/** A send is held in the queue, read at call time. */
	isQueued: () => boolean;
	/** A send was started on this tab and not cleared by New chat. */
	hasAttemptedSend: () => boolean;
	/** The tab's local history record binding (I269). */
	getRecordId: () => string | null;
	warn: (message: string, error: unknown) => void;
}

export interface SessionRetirementApi {
	snapshot: () => UnsentDiscardDecision;
	discard: (decision: UnsentDiscardDecision) => Promise<UnsentDiscardOutcome>;
	retire: (
		retire: SessionRetirement,
		port: Omit<SessionRetirementPort, "discardUnsent">,
		decision: UnsentDiscardDecision,
	) => Promise<SessionRetirementOutcome>;
}

export function useSessionRetirement(
	args: UseSessionRetirementArgs,
): SessionRetirementApi {
	const argsRef = useRef(args);
	argsRef.current = args;

	return useMemo<SessionRetirementApi>(() => {
		const snapshot = (): UnsentDiscardDecision => {
			const a = argsRef.current;
			const id = a.getSessionId();
			return decideUnsentDiscard({
				sessionId: id,
				deletesSessions:
					a.client.getInitializeResult()?.capabilities.deletesSessions ??
					false,
				createdHereUnsent: id !== null && a.client.isUnsentSession(id),
				sendAttempted: a.hasAttemptedSend() || a.isQueued(),
				messageCount: a.getMessageCount(),
				hasLocalRecord: a.getRecordId() !== null,
			});
		};
		const discard = (decision: UnsentDiscardDecision) => {
			const a = argsRef.current;
			return discardUnsentSession(
				decision,
				unsentDiscardPortFor(a.client, a.warn),
			);
		};
		return {
			snapshot,
			discard,
			retire: (retire, port, decision) =>
				retireLiveSession(retire, {
					...port,
					discardUnsent: () => discard(decision),
				}),
		};
	}, []);
}

// ============================================================================
// Idle release (I209 + I259)
// ============================================================================

export interface IdleReleaseDiscardArgs {
	/** I237: keep the id when there is something to resume. */
	keepSessionId: () => boolean;
	retirement: () => SessionRetirementApi | null;
	/** useLazySession.release({ keepSessionId }). */
	lazyRelease: (keepSessionId: boolean) => boolean;
	/** useAgent.resetSendAttempt: a discarded id takes its attempt with it. */
	resetSendAttempt: () => void;
}

/**
 * The `snapshotDiscard` and `lazyRelease` steps of `runIdleRelease`, from one
 * keep decision. A kept id (I237) is never deleted, because the next
 * keystroke loads it: deleting it would land on the I282 notice.
 */
export function idleReleaseDiscardSteps(args: IdleReleaseDiscardArgs): {
	snapshotDiscard: () => () => Promise<unknown>;
	lazyRelease: () => boolean;
} {
	let keep = true;
	return {
		snapshotDiscard: () => {
			keep = args.keepSessionId();
			const retirement = args.retirement();
			if (keep || !retirement) return () => Promise.resolve();
			const decision = retirement.snapshot();
			return () => retirement.discard(decision);
		},
		lazyRelease: () => {
			const released = args.lazyRelease(keep);
			if (released && !keep) args.resetSendAttempt();
			return released;
		},
	};
}
