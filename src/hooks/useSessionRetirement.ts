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
	/** The tab's live agent session id (this render). */
	sessionId: string | null;
	/** Messages on screen (this render). */
	messageCount: number;
	/** A send is held in the queue (this render). */
	isQueued: boolean;
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
			const id = a.sessionId;
			return decideUnsentDiscard({
				sessionId: id,
				deletesSessions:
					a.client.getInitializeResult()?.capabilities.deletesSessions ??
					false,
				createdHereUnsent: id !== null && a.client.isUnsentSession(id),
				sendAttempted: a.hasAttemptedSend() || a.isQueued,
				messageCount: a.messageCount,
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
