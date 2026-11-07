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
 *       permission → busy → stopped-unseen → done-unseen → ready
 */
export function deriveTabState(input: TabStateInput): TabState {
	const { lifecycle, isSending, hasActivePermission, unseen, hasHeldSession } =
		input;
	const unseenState: TabState | null =
		unseen === null
			? null
			: unseen.kind === "done"
				? "doneUnseen"
				: "stoppedUnseen";

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
