/**
 * Types for useAutoScrollPin hook (Phase 2).
 *
 * The hook owns BOTH pin state and scroll position. There is no other
 * authority. See the spec at
 * 04-initiatives/Agent Console/ACP Scroll Architecture Rework.md
 * § Phase 2 architecture for the full design rationale.
 *
 * Phase 1 used a `pinned | unpinned | restoring` discriminated union with
 * the virtualizer as scroll authority. Phase 2 collapses to two booleans
 * (`isAtBottom`, `escapedFromLock`) with the hook directly writing
 * `scrollTop`. The seam between hook state and virtualizer scroll
 * (the source of I-S2/I-S3/I-S4) no longer exists in the architecture.
 *
 * Reference: stackblitz-labs/use-stick-to-bottom (~2.2M weekly downloads,
 * used by Bolt.new, shadcn AI, Vercel ai-elements). The Phase 2 design is
 * adapted from that hook, with deliberate omissions (no spring engine
 * per Decision #17, no `wait`/`duration`/`ignoreEscapes` options) and
 * deliberate additions per spec Decisions #21 and #22 (dual ResizeObserver,
 * touch listeners, selection-vs-scroll discrimination, scroll-behavior
 * override on programmatic writes).
 */

import type { RefCallback } from "react";
import type { IChatViewHost } from "./view-host";

// ============================================================================
// Stickiness threshold
// ============================================================================

/**
 * Gap (px) below which the viewport is considered "at the bottom" and
 * auto-scroll engages. Same value as use-stick-to-bottom's default.
 *
 * 70 px is generous enough to absorb wheel-event throttling and
 * momentum-scroll undershoot, while tight enough that the pill appears
 * promptly when the user genuinely scrolls up. Spec Decision #21
 * validates this against react-virtuoso (4 px, only works with
 * pixel-exact virtualizer measurement) and use-stick-to-bottom (70 px,
 * battle-tested at scale).
 *
 * Revisit only if smoke-test surfaces flicker around the boundary.
 */
export const STICK_OFFSET_PX = 70;

// ============================================================================
// Hook params and result
// ============================================================================

/**
 * Inputs to useAutoScrollPin.
 *
 * Compared to Phase 1: `containerRef`, `virtualizerRef`, and `messageCount`
 * are gone. The hook now exposes its own `scrollRef` and `contentRef` as
 * RefCallbacks (per use-stick-to-bottom's pattern), and content-grow
 * detection comes from ResizeObserver — message count is irrelevant.
 */
export interface UseAutoScrollPinParams {
	/**
	 * Whether this tab is currently active (visible). When false, the hook
	 * stops doing DOM-observation work; on reactivation, if `isAtBottom`
	 * was true, the hook re-anchors to the bottom once.
	 */
	isActive: boolean;

	/**
	 * Whether a message is currently being sent (user just submitted).
	 * The hook's first scroll after this flips true uses smooth behavior
	 * for the user-sent path.
	 */
	isSending: boolean;

	/**
	 * ChatView host for Obsidian-managed event registration. Listeners
	 * registered via `host.registerDomEvent` are auto-cleaned-up on view
	 * close.
	 */
	view: IChatViewHost;
}

/**
 * Outputs from useAutoScrollPin.
 *
 * Compared to Phase 1: `pinState` and `isPinned` collapse to `isAtBottom`.
 * `shouldAdjust` is gone (no virtualizer to gate). `scrollRef` and
 * `contentRef` are new — the hook now owns the DOM refs.
 */
export interface UseAutoScrollPinResult {
	/**
	 * RefCallback to attach to the scroll container element. The hook
	 * uses this to:
	 * - Attach `scroll`, `wheel`, `touchstart`, `touchmove` listeners
	 * - Attach a ResizeObserver (for container-shrink detection per spec
	 *   Decision #21 Finding 1)
	 * - Read scroll position and write `scrollTop` for auto-scroll
	 */
	scrollRef: RefCallback<HTMLDivElement>;

	/**
	 * RefCallback to attach to the content element (the inner div whose
	 * height grows as messages stream in). The hook attaches a
	 * ResizeObserver to detect content growth.
	 */
	contentRef: RefCallback<HTMLDivElement>;

	/**
	 * True when the viewport is at or near the bottom (within
	 * `STICK_OFFSET_PX`). Drives auto-scroll-on-content-grow and pill
	 * visibility (`!isAtBottom` → show pill).
	 *
	 * This is also true while `escapedFromLock` is true if the user has
	 * scrolled back to within the offset (so the pill disappears).
	 */
	isAtBottom: boolean;

	/**
	 * Imperative request to scroll to the bottom and re-pin. Used by the
	 * pill click handler.
	 *
	 * - `behavior: "smooth"` (default for pill click) — uses native CSS
	 *   `scroll-behavior: smooth` for the duration of the scroll.
	 * - `behavior: "auto"` — instant, uses the override pattern from
	 *   Decision #22 to bypass any inherited smooth-scroll CSS.
	 */
	scrollToBottom: (options?: { behavior?: "smooth" | "auto" }) => void;
}
