/**
 * `deriveSendAffordance` — the single pure resolver for send-button
 * enablement in Agent Console.
 *
 * WHY THIS EXISTS
 * Whether a send can happen used to be decided by two predicates that had to
 * agree but were maintained independently — `ChatPanel.canSend()` and
 * `InputArea.isButtonDisabled` — plus further `!isSessionReady`-style
 * derivations in `InputToolbar`, `MessageList`, and the broadcast dispatch
 * bail. When they drifted, sends were silently blocked or wrongly allowed
 * (I40, I41, I42, I43, I70 all landed as edits to one scattered predicate).
 * This module is the one decision every consumer reads.
 *
 * DESIGN (approved option (a), 2026-06-27)
 *  - Keys on the full 6-member {@link TabSessionState} union. `busy` and
 *    `permission` are "live" (a session is connected); only `error` is a hard
 *    non-sendable state. Idle/connecting are sendable — they trigger lazy
 *    acquisition + queue (the send-while-connecting path).
 *  - Drops the separate `isSessionReady` (agent.isReady) boolean the old
 *    predicates ORed in: `lazyState` is the canonical readiness signal, so the
 *    two can no longer drift. (`isSessionReady` was equivalent to
 *    lazyState ∈ {ready, busy, permission} — see {@link isSessionLive}.)
 *  - `canSend` mirrors the prior `ChatPanel.canSend`, which did NOT block on
 *    `isQueued`: the queue-of-one cap is enforced downstream (and broadcast
 *    excludes already-queued tabs via `hasPendingQueue()`), so `canSend` is
 *    true for reason ∈ {ready, queued}.
 *
 * Pure — no React, no Obsidian. Safe to unit-test exhaustively.
 */
import type { TabSessionState } from "../hooks/useTabSessionState";

/**
 * Why a send is or isn't available, in priority order. Consumers render
 * disabled-state copy from this (combined with `lazyState` for the
 * idle-vs-connecting wording distinction that drove I40).
 */
export type SendAffordanceReason =
	| "ready" // sendable now (or sendable via lazy acquisition for idle/connecting)
	| "empty" // no text and no attachments
	| "queued" // a message is held in the queue-of-one (composer is locked)
	| "restoring" // session history is loading
	| "error" // the lazy session is in the error state
	| "sending"; // a turn is in flight (button shows Stop, not disabled)

export interface SendAffordanceInput {
	/** Per-tab lazy session state machine value. */
	lazyState: TabSessionState;
	/** A turn is currently streaming. */
	isSending: boolean;
	/** This tab holds a pending queued message (queue-of-one). */
	isQueued: boolean;
	/** Composer has text or attachments. */
	hasContent: boolean;
	/** Session history is being restored/loaded. */
	isRestoringSession: boolean;
}

export interface SendAffordance {
	/** Programmatic / broadcast send gate. True for reason ∈ {ready, queued}. */
	canSend: boolean;
	/** Whether the Send button is disabled. False while sending (it's Stop). */
	buttonDisabled: boolean;
	/** Why-disabled, so UI copy derives from the same source. */
	reason: SendAffordanceReason;
}

/**
 * The single send-enablement decision. See module doc for the design rules.
 */
export function deriveSendAffordance(
	input: SendAffordanceInput,
): SendAffordance {
	const { lazyState, isSending, isQueued, hasContent, isRestoringSession } =
		input;

	// Reason — priority order. `sending` first: a live turn means the button is
	// the Stop control (enabled), and a new send is not possible.
	let reason: SendAffordanceReason;
	if (isSending) {
		reason = "sending";
	} else if (isRestoringSession) {
		reason = "restoring";
	} else if (lazyState === "error") {
		reason = "error";
	} else if (!hasContent) {
		reason = "empty";
	} else if (isQueued) {
		reason = "queued";
	} else {
		reason = "ready";
	}

	// canSend (programmatic / broadcast gate): content present, session not in
	// error, not restoring, not currently sending. Intentionally does NOT block
	// on `isQueued` — preserves prior ChatPanel.canSend behavior; the queue cap
	// is a downstream guard and broadcast filters queued tabs separately.
	const canSend =
		hasContent &&
		lazyState !== "error" &&
		!isRestoringSession &&
		!isSending;

	// buttonDisabled: when NOT sending, disable for a held queue, empty input,
	// error, or restoring. While sending the button is enabled (Stop).
	const buttonDisabled =
		!isSending &&
		(isQueued || !hasContent || lazyState === "error" || isRestoringSession);

	return { canSend, buttonDisabled, reason };
}

/**
 * A session is "live" — connected and able to accept an immediate dispatch, as
 * opposed to idle/connecting (sendable, but requires lazy acquisition + queue)
 * or error. Equivalent to the prior `isSessionReady` (agent.isReady) signal:
 * `ready | busy | permission`.
 *
 * Used by the broadcast dispatch-vs-queue bail so the lazyState→live mapping
 * lives in one place instead of being re-derived as a scattered
 * `!isSessionReady` (the I70 drift). Keeping it in this module ties the
 * dispatch-readiness axis to the same canonical `lazyState` the resolver reads.
 */
export function isSessionLive(lazyState: TabSessionState): boolean {
	return (
		lazyState === "ready" ||
		lazyState === "busy" ||
		lazyState === "permission"
	);
}
