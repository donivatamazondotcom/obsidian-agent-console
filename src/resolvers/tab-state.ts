/**
 * `deriveTabState` — the single pure resolver for a tab's visual state icon.
 *
 * WHY THIS EXISTS
 * The tab icon state was previously driven by two edge-triggered effects in
 * ChatPanel that mutated the `useTabSessionState` machine:
 *
 *     if (!wasSending && isSending && lazySession.state === "ready")
 *         lazySession.startBusy();
 *     ...
 *     lazySession.requestPermission() / resolvePermission()
 *
 * Both encoded a read decision ("what glyph should this tab show?") as a chain
 * of fragile state-machine transitions gated on connection state:
 *
 *   - `startBusy` only fired when the session was already `"ready"` at the
 *     `isSending` rising edge. For a lazy tab's FIRST send, `isSending` rises
 *     while the session is still `"connecting"` (acquisition and send-intent
 *     coincide), so the guard was false and `busy` was never entered — the tab
 *     showed ● "ready" for the whole streamed reply instead of ◐ "busy".
 *   - `resolvePermission` always returned the machine to `"ready"`, so a
 *     permission resolved mid-turn dropped the tab to `ready` even while the
 *     agent kept working.
 *
 * Adding a term to a guard to fix each of these is the signal the decision was
 * never centralized (same lesson as `deriveHeaderSlot`/I80). This resolver
 * makes the decision once, gating on INTENT (`isSending`) and permission
 * (`hasActivePermission`) overlaid on the connection lifecycle — recomputed
 * every render, so a missed edge can't strand the icon.
 *
 * Pure — no React, no Obsidian. Total over every `TabSessionState`. See
 * `src/resolvers/__tests__/tab-state.test.ts` for the exhaustive truth table.
 */

import type { ErrorInfo } from "../types/errors";
import type { TurnEnd } from "../types/session";
import type { TabSessionState, TabState, TabUnseen } from "../types/tab";

export interface TabStateInput {
	/**
	 * Connection lifecycle from the per-tab session machine
	 * (`useTabSessionState`). Only the connection states are meaningful here —
	 * `busy`/`permission` are no longer driven into the machine (this resolver
	 * derives them), but are handled defensively so the function is total.
	 */
	lifecycle: TabSessionState;
	/**
	 * The agent is processing this turn — a send is in flight or a reply is
	 * still streaming. This is the "is the agent working" intent signal that
	 * gates the busy glyph, independent of when the connection transition
	 * landed relative to the send.
	 */
	isSending: boolean;
	/** The agent is blocked awaiting a permission decision. */
	hasActivePermission: boolean;
	/**
	 * A turn ended while the user wasn't looking ([[Tab Attention States]]).
	 * From the pure reducer in `resolvers/tab-unseen.ts`.
	 */
	unseen: TabUnseen;
	/**
	 * The tab holds a session id for its next connect: restored from disk, or
	 * kept by an idle release (`useLazySession.keptSessionId !== null`). Tells
	 * a restored tab that hasn't woken apart from a brand-new tab, since both
	 * sit in `idle` (I292). Read from session state, never from the agent id.
	 */
	hasHeldSession: boolean;
	/**
	 * The error banner on screen is the one the last failed turn raised
	 * ({@link hasFailedTurnBanner}). I316: without it a failure you had seen
	 * read "Ready" while the banner was still up.
	 */
	hasFailedTurnBanner: boolean;
}

/**
 * I316: the banner on screen is the last failed turn's own. Compared by
 * identity, so dismissing it, a later turn, or a different error replacing it
 * each clear the state without extra bookkeeping. `errorInfo` is a single
 * `useState` and every writer passes a fresh object.
 */
export function hasFailedTurnBanner(
	lastTurnEnd: TurnEnd | null,
	errorInfo: ErrorInfo | null,
): boolean {
	return (
		lastTurnEnd?.outcome === "failed" &&
		errorInfo !== null &&
		errorInfo === lastTurnEnd.errorInfo
	);
}

/**
 * The single tab-icon-state decision ([[Tab Attention States]]). Precedence:
 *  1. `error` lifecycle → error (the session is dead).
 *  2. `connecting` → connecting.
 *  3. `idle` → connecting once a send is pending. Otherwise:
 *       - holding a session id (a restored tab that hasn't woken, I292) →
 *         asleep like `released`: an unread result if there is one, else
 *         released. A stale permission flag is ignored.
 *       - no held id (a fresh lazy tab) → ready. (Was `disconnected`, which
 *         made a new tab look like a dead one.)
 *  4. `released` → an unread result if there is one, else released. Stale
 *     sending / permission flags from before the release are ignored.
 *  5. live lifecycle (`ready`/`busy`/`permission`):
 *       permission → busy → stopped-unseen → failed → done-unseen → ready
 *
 * I316: `failed` (the last turn failed and its banner is still up) sits in the
 * attention order wherever an unread mark can show, so it also outranks the
 * moon on an asleep tab. A turn can't both fail and finish, so `failed` and
 * done-unseen never compete.
 */
export function deriveTabState(input: TabStateInput): TabState {
	const {
		lifecycle,
		isSending,
		hasActivePermission,
		unseen,
		hasHeldSession,
		hasFailedTurnBanner: failedBanner,
	} = input;
	const unseenState: TabState | null =
		unseen?.kind === "stopped"
			? "stoppedUnseen"
			: failedBanner
				? "failed"
				: unseen?.kind === "done"
					? "doneUnseen"
					: null;

	switch (lifecycle) {
		case "error":
			return "error";
		case "connecting":
			return "connecting";
		case "idle":
			if (isSending) return "connecting";
			return hasHeldSession ? (unseenState ?? "released") : "ready";
		case "released":
			return unseenState ?? "released";
		case "ready":
		case "busy":
		case "permission": {
			if (hasActivePermission) return "permission";
			if (isSending) return "busy";
			return unseenState ?? "ready";
		}
	}
}
