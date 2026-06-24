/**
 * message-queue-logic — pure decision helpers for the queue-next-message
 * feature (#82). Extracted from ChatPanel / plugin so the load-bearing
 * decisions (queue vs send, flush vs hold, broadcast skip) are unit-testable
 * without mounting the React tree — same pattern as the I70 broadcast test.
 *
 * See [[Agent Console Queue Next Message]].
 */

import type { AttachedFile, QueuedMessage } from "../types/chat";

/**
 * Whether a send action should QUEUE rather than dispatch a turn.
 *
 * Queue is the default while the agent is streaming (a turn is in flight);
 * when idle there is nothing to queue behind, so the send dispatches normally.
 * `isSending` is true only on a live, streaming session, so it alone is the
 * trigger.
 */
export function shouldQueueOnSend(params: { isSending: boolean }): boolean {
	return params.isSending;
}

/** What pressing the send key (Enter) in the composer should do. */
export type ComposerEnterAction = "send" | "queue" | "none";

/**
 * Decide the Enter-key action in the composer (#82).
 *
 * - **send** — not streaming and the send button is enabled → normal dispatch.
 * - **queue** — streaming, nothing queued yet, and there is content → queue the
 *   next message (the locked-input affordance).
 * - **none** — streaming with a message already queued (queue-of-one), empty
 *   composer, or the send button is disabled (connecting/restoring).
 */
export function decideComposerEnterAction(params: {
	isStreaming: boolean;
	isButtonDisabled: boolean;
	isQueued: boolean;
	hasContent: boolean;
}): ComposerEnterAction {
	if (!params.isStreaming && !params.isButtonDisabled) return "send";
	if (params.isStreaming && !params.isQueued && params.hasContent) {
		return "queue";
	}
	return "none";
}

/**
 * Composer placeholder text (#82 affordance — option A, discovery-only).
 *
 * While the agent is streaming (and nothing is queued yet), the empty-composer
 * placeholder teaches the queue keybinding — the same way the idle placeholder
 * teaches "@ to mention / for commands." It's discovery-only: it shows when the
 * composer is empty and vanishes once the user types (placeholders only render
 * when empty), which is acceptable because the binding is learned once.
 *
 * Queue-only wording for now; the steering keybinding ([[Agent Console
 * Mid-Stream Steering]] #81) gets added here when that ships.
 */
export function buildComposerPlaceholder(params: {
	agentLabel: string;
	hasCommands: boolean;
	isStreaming: boolean;
	isQueued: boolean;
}): string {
	if (params.isStreaming && !params.isQueued) {
		return `Queue a message – hit Enter to send when ${params.agentLabel} is done`;
	}
	return `Message ${params.agentLabel} - @ to mention notes${params.hasCommands ? ", / for commands" : ""}`;
}

export interface FlushDecisionParams {
	/** The turn ended this tick: isSending went true -> false. */
	turnEnded: boolean;
	/** A message is currently queued. */
	isQueued: boolean;
	/** The turn that just ended errored (errorInfo was set). */
	hadError: boolean;
	/** The turn that just ended was cancelled by the user (stop generation). */
	wasCancelled: boolean;
}

/**
 * Whether to auto-send the queued message now.
 *
 * Decision 5 (hold-on-error/cancel): a queued message auto-fires ONLY when the
 * turn it was waiting on completed normally. An errored or cancelled turn
 * holds the queued message (it does not fire into the dead turn); it degrades
 * to a preserved draft if the turn is later destroyed (close/reopen, restart).
 *
 * Contrast {@link naiveShouldFlush} (test-only) which fires on any turn end —
 * the bug this guard prevents.
 */
export function shouldFlushQueue(params: FlushDecisionParams): boolean {
	return (
		params.turnEnded &&
		params.isQueued &&
		!params.hadError &&
		!params.wasCancelled
	);
}

/**
 * Perform the queue flush: consume the head, clear the composer, then dispatch
 * through the normal send path — in that order.
 *
 * The ordering is load-bearing (T3/T4): clearing the composer BEFORE dispatch
 * means draft-preservation observes the emptied composer and persists "" — a
 * side-channel send that skipped the clear would strand a stale draft. Routing
 * `dispatch` through the normal send path (handleSendWithLazyAcquisition) is
 * what makes the cleared value persist on the next save event.
 *
 * @returns true if a message was flushed, false if the queue was empty.
 */
export function executeFlush(deps: {
	consume: () => QueuedMessage | null;
	clearComposer: () => void;
	dispatch: (content: string, attachments?: AttachedFile[]) => void;
}): boolean {
	const payload = deps.consume();
	if (!payload) return false;
	deps.clearComposer();
	deps.dispatch(payload.content, payload.attachments);
	return true;
}

/**
 * Whether the composer's send action (button click or Enter) must be blocked
 * because a message is queued (#82, smoke-test issue 3).
 *
 * While streaming, the primary button is **Stop** (isSending true) — that must
 * stay live so the user can cancel (T7), so this returns false then. But once
 * a queued message is being *held* (queued + no live turn, e.g. after an
 * errored/cancelled turn), the composer is locked and the Send button would
 * otherwise fire the locked text, bypassing the queue. Block it — the user
 * acts via Edit/Delete instead.
 */
export function isQueuedSendBlocked(params: {
	isQueued: boolean;
	isSending: boolean;
}): boolean {
	return params.isQueued && !params.isSending;
}

/** Minimal shape of a broadcast target for skip-guard selection. */
export interface BroadcastTarget {
	readonly tabId: string;
	canSend(): boolean;
	/** True when this tab already holds a pending queued message (#82). */
	hasPendingQueue(): boolean;
}

/**
 * Tabs that broadcast-send should fan out to.
 *
 * Skips tabs already holding a pending queued message (queue-of-one — can't
 * add a second) in addition to the existing canSend() gate. Skipped tabs are
 * reported in the summary Notice.
 */
export function selectBroadcastSendTargets<T extends BroadcastTarget>(
	handles: T[],
): { targets: T[]; skippedQueued: T[] } {
	const skippedQueued = handles.filter(
		(h) => h.canSend() && h.hasPendingQueue(),
	);
	const targets = handles.filter((h) => h.canSend() && !h.hasPendingQueue());
	return { targets, skippedQueued };
}

/**
 * Tabs that broadcast-prompt should write into (excluding the source tab).
 *
 * Skips tabs holding a pending queued message — overwriting their composer
 * (setInputState) would clobber a committed message (data loss). This narrowly
 * overrides F11 decision #4 (unconditional draft overwrite) for *queued*
 * (committed) messages only, not loose drafts.
 */
export function selectBroadcastPromptTargets<
	T extends Pick<BroadcastTarget, "tabId" | "hasPendingQueue">,
>(handles: T[], sourceTabId: string): { targets: T[]; skippedQueued: T[] } {
	const others = handles.filter((h) => h.tabId !== sourceTabId);
	const skippedQueued = others.filter((h) => h.hasPendingQueue());
	const targets = others.filter((h) => !h.hasPendingQueue());
	return { targets, skippedQueued };
}
