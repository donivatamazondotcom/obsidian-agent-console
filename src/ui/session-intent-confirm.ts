/**
 * SEAM (Track 1 ↔ Track 2) — shared confirm / carry-over modal contract.
 *
 * The Local-First Session Model splits across two tracks that share ONE UI
 * surface: this confirm/carry-over modal. **Track 2 owns the component**
 * ([[Agent-Portable Sessions]]); Track 1 (the unified local store, this
 * branch) defines the interface so both tracks agree on the contract and the
 * restore/fork wiring can reference the seam without the component existing
 * yet.
 *
 * Why Track 1 does NOT invoke it: Track 1's restore and fork are non-lossy.
 * They open a NEW tab seeded with the local transcript and never clear the
 * active session (see `ChatView.openSessionInTab` — restore/fork-in-new-tab),
 * so there is nothing to guard. This modal is Track 2's guard surface for the
 * three silent-clear transitions audited in [[Local-First Session Model]]:
 * switch-with-messages, new-chat-over-messages, and hard-reload. The interface
 * lives here, in Track 1's foundation, as the agreed coordination point.
 *
 * User-facing copy (the modal's text/buttons) is plain, high-school-level
 * English with no internal jargon — Track 2 owns the copy per the per-case
 * strings in [[Agent-Portable Sessions]].
 */

/** Which transition is being confirmed. Drives the per-case copy + buttons. */
export type SessionIntentKind = "switch-agent" | "new-chat" | "reload";

/** What the modal needs to render the right copy and offer the right choice. */
export interface SessionIntentConfirmRequest {
	/** The transition the user is about to take. */
	kind: SessionIntentKind;
	/**
	 * Whether the target agent can be given the earlier conversation (so a
	 * "carry the conversation over" choice is meaningful). When false, the
	 * only non-cancel choice is to proceed and leave the transcript behind.
	 */
	canCarryOver: boolean;
}

/** The user's decision from the confirm/carry-over modal. */
export type SessionIntentDecision =
	/** Proceed and carry the earlier messages over to the target. */
	| "carry-over"
	/** Proceed but start fresh (leave the earlier transcript behind). */
	| "proceed-fresh"
	/** Abort the transition; nothing changes. */
	| "cancel";

/**
 * The shared modal Track 2 implements. Resolves with the user's decision.
 * Track 1 references the TYPE only; the IMPLEMENTATION is Track 2's.
 */
export interface SessionIntentConfirmModal {
	/** Present the confirm/carry-over modal and resolve with the choice. */
	confirm(
		request: SessionIntentConfirmRequest,
	): Promise<SessionIntentDecision>;
}
