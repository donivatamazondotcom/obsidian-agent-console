/**
 * Types for useAutoScrollPin hook.
 *
 * The hook owns all auto-scroll behavior for MessageList. See the spec at
 * 04-initiatives/Agent Console/ACP Scroll Architecture Rework.md for the
 * full design rationale, transition table, and acceptance criteria
 * (T100-T131).
 *
 * Design principle: all auto-scroll behavior lives inside the hook;
 * MessageList provides DOM handles and render decisions, never owns
 * scroll state directly.
 */

import type { RefObject } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { IChatViewHost } from "./view-host";

// ============================================================================
// Pin state union
// ============================================================================

/**
 * Discriminated string-literal union for the auto-scroll pin state.
 *
 * Follows the codebase convention of TabState/SessionState (rather than a
 * full FSM with useReducer). Three states are sufficient:
 *
 * - `pinned`: Viewport is at the bottom; auto-scroll engaged. Authority A
 *   (virtualizer's `shouldAdjustScrollPositionOnItemSizeChange`) returns
 *   true on this tab. New messages auto-scroll.
 *
 * - `unpinned`: User has scrolled up; auto-scroll suppressed. Scroll-to-
 *   bottom pill is visible. New messages do NOT auto-scroll.
 *
 * - `restoring`: An explicit scroll target is in flight (pill click, tab
 *   activation with prior pin, smooth scroll on user-sent message). Authority
 *   A returns false transiently so it doesn't fight an explicit scroll. The
 *   state resolves back to `pinned` on completion.
 */
export type PinState = "pinned" | "unpinned" | "restoring";

// ============================================================================
// Hysteresis thresholds
// ============================================================================

/**
 * Gap (px) above which a `pinned` state flips to `unpinned`.
 * Distinguishes "user genuinely scrolled away" from "DOM measurement race
 * during streaming". Roughly one short message's worth of vertical space.
 *
 * Closes I37 Mechanisms 2 & 3 and I36 partial regression — captured
 * evidence showed false-flip gaps of 37/60/80 px during streaming, all
 * below this threshold.
 */
export const NEAR_BOTTOM_FLIP_TO_FALSE_PX = 100;

/**
 * Gap (px) below which an `unpinned` state flips back to `pinned`.
 * Preserves existing slack-zone semantics from the original 35-px threshold.
 */
export const NEAR_BOTTOM_FLIP_TO_TRUE_PX = 35;

// ============================================================================
// Hook params and result
// ============================================================================

/**
 * Inputs to useAutoScrollPin. All refs must be stable across renders.
 *
 * The hook reads from refs (not state) to avoid re-renders on container/
 * virtualizer object identity changes.
 */
export interface UseAutoScrollPinParams {
	/**
	 * Container element ref (the scroll element). The hook attaches a
	 * scroll listener and an IntersectionObserver to this element.
	 *
	 * The ref must be stable. The hook does not handle container element
	 * swaps mid-mount; if the consumer needs to swap the container, it
	 * should remount the component (which will re-run the hook).
	 */
	containerRef: RefObject<HTMLDivElement | null>;

	/**
	 * Virtualizer ref for explicit scroll-to-bottom calls. The hook
	 * uses `virtualizerRef.current.scrollToIndex(messageCount - 1,
	 * { align: "end" })` for restore transitions.
	 */
	virtualizerRef: RefObject<Virtualizer<HTMLDivElement, Element> | null>;

	/**
	 * Number of messages currently in the list. Used to detect "new message
	 * arrived" transitions. Note: this is only the count, not the array
	 * reference — streaming chunks that grow an existing message do NOT
	 * change the count, and Authority A handles those (see I36 root cause).
	 */
	messageCount: number;

	/**
	 * Whether this tab is currently active (visible). When false, the
	 * hook captures the current pin state for the next reactivation
	 * and stops doing DOM-observation work.
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
	 * registered via host.registerDomEvent are auto-cleaned-up on view close.
	 */
	view: IChatViewHost;
}

/**
 * Outputs from useAutoScrollPin. Consumers (MessageList) wire these to
 * their virtualizer and pill UI.
 */
export interface UseAutoScrollPinResult {
	/**
	 * Current pin state. Primarily for UI affordances (pill visibility).
	 * `restoring` is a transient state visible briefly during explicit
	 * scrolls; consumers that don't need to distinguish it from `unpinned`
	 * can use `isPinned` instead.
	 */
	pinState: PinState;

	/**
	 * Convenience boolean: `pinState === "pinned"`. The scroll-to-bottom
	 * pill is typically rendered when `!isPinned`.
	 */
	isPinned: boolean;

	/**
	 * Gate function to install on the virtualizer's
	 * `shouldAdjustScrollPositionOnItemSizeChange`. Returns true when the
	 * virtualizer should auto-adjust scroll on size changes (active tab AND
	 * pinned). Stable identity across renders.
	 */
	shouldAdjust: () => boolean;

	/**
	 * Imperative request to scroll to the bottom and re-pin. Used by the
	 * pill click handler and any external "restore pin" affordance.
	 *
	 * - `behavior: "smooth"` for user-initiated actions (pill click)
	 * - `behavior: "auto"` (default) for system-initiated restores
	 */
	scrollToBottom: (options?: { behavior?: "smooth" | "auto" }) => void;
}
