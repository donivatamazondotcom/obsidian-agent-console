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

import type { TabSessionState } from "../hooks/useTabSessionState";
import type { TabState } from "../types/tab";

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
}

/**
 * The single tab-icon-state decision. Precedence:
 *  1. `error` lifecycle → error (nothing else matters — the session is dead).
 *  2. `idle`/`connecting` → disconnected (no live session yet; a pending send
 *     during connect does NOT show busy — matches the pre-existing connect
 *     display and the header's "Connecting…" semantics).
 *  3. live lifecycle (`ready`/`busy`/`permission`):
 *       - active permission wins over sending → permission
 *       - else processing → busy
 *       - else → ready
 */
export function deriveTabState(input: TabStateInput): TabState {
	const { lifecycle, isSending, hasActivePermission } = input;

	switch (lifecycle) {
		case "error":
			return "error";
		case "idle":
		case "connecting":
			return "disconnected";
		case "ready":
		case "busy":
		case "permission": {
			if (hasActivePermission) return "permission";
			if (isSending) return "busy";
			return "ready";
		}
	}
}
