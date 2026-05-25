/**
 * useAutoScrollPin — Phase 2 native-scroll architecture.
 *
 * The hook owns BOTH pin state and scroll position. There is no virtualizer
 * and no other authority. See the spec at
 * 04-initiatives/Agent Console/ACP Scroll Architecture Rework.md
 * § Phase 2 architecture for the full design rationale.
 *
 * Architecture:
 *   - `wheel` listener on scrollRef → user intent to scroll up = escape
 *   - `touchstart`/`touchmove` listeners on scrollRef → mobile escape
 *   - `scroll` listener on scrollRef → user scrolled back near bottom = un-escape
 *   - `ResizeObserver` on contentRef → content grew, write scrollTop if pinned
 *   - `ResizeObserver` on scrollRef → container shrank, write scrollTop if pinned
 *     (per spec Decision #21 Finding 1; closes use-stick-to-bottom Issue #40)
 *   - Global `mousedown`/`mouseup`/`click` + `getSelection().rangeCount`
 *     → suppress wheel/scroll-driven escape during text-selection drag
 *     (per spec Decision #21 Finding 4)
 *   - Programmatic `scrollTop` writes wrap with `scroll-behavior: auto`
 *     override (per spec Decision #22)
 *
 * Reference: stackblitz-labs/use-stick-to-bottom. The Phase 2 design is
 * adapted from that hook — see source at /tmp/use-stick-to-bottom for the
 * canonical algorithm. Deliberate deviations:
 *   - No spring animation engine (Decision #17). Native CSS smooth-scroll only.
 *   - No `wait`/`duration`/`ignoreEscapes` options on `scrollToBottom`.
 *   - No `targetScrollTop` calculation hook. Fixed `scrollHeight - clientHeight`.
 *   - No `isNearBottom` separate from `isAtBottom`. One boolean.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	UseAutoScrollPinParams,
	UseAutoScrollPinResult,
} from "./use-auto-scroll-pin.types";
import { STICK_OFFSET_PX } from "./use-auto-scroll-pin.types";

// ============================================================================
// Module-level mouse state for selection-vs-scroll discrimination
// (per spec Decision #21 Finding 4)
// ============================================================================

/**
 * Tracks whether the primary mouse button is currently pressed. Set by
 * global document listeners attached on first hook mount, cleared on
 * mouseup/click. Used by `isSelecting()` to distinguish text-selection
 * drag from genuine wheel/scroll user intent.
 *
 * Mirrors use-stick-to-bottom's module-level `mouseDown` boolean.
 * Single global state is correct here: the document only has one mouse.
 */
let mouseDown = false;
let globalListenersAttached = false;

function ensureGlobalMouseListeners(): void {
	if (globalListenersAttached) return;
	if (typeof document === "undefined") return; // SSR / JSDOM-without-document safety

	document.addEventListener("mousedown", () => {
		mouseDown = true;
	});
	document.addEventListener("mouseup", () => {
		mouseDown = false;
	});
	document.addEventListener("click", () => {
		mouseDown = false;
	});
	globalListenersAttached = true;
}

// ============================================================================
// Programmatic scroll write helper (per spec Decision #22)
// ============================================================================

/**
 * Set `scrollEl.scrollTop = value` while temporarily forcing
 * `scroll-behavior: auto` so the browser does not smooth-animate
 * the programmatic write. Restores the original value after.
 *
 * Without this, native CSS `scroll-behavior: smooth` (which is desired
 * for user-action paths like pill click) creates a feedback loop with
 * ResizeObserver-driven streaming auto-scroll: write → smooth animation
 * in flight → next chunk → write again → animation cancels → jitter.
 *
 * Pattern adapted from `useStickToBottom.ts` lines 174–188.
 */
function setScrollTopInstant(scrollEl: HTMLElement, value: number): void {
	const computed = getComputedStyle(scrollEl);
	const previousBehavior = computed.scrollBehavior;
	const needsOverride = previousBehavior !== "auto";

	if (needsOverride) {
		// Decision #22: temporarily override CSS scroll-behavior on the
		// element to make the programmatic scrollTop write instant. The
		// plugin's no-static-styles-assignment rule asks for CSS classes,
		// but a CSS class can't time-bound the override to one synchronous
		// write — the helper must restore the previous value immediately.
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		scrollEl.style.scrollBehavior = "auto";
	}
	scrollEl.scrollTop = value;
	if (needsOverride) {
		scrollEl.style.scrollBehavior = previousBehavior;
	}
}

/**
 * Compute the scroll-top value that places the viewport at the bottom.
 * Uses `scrollHeight - clientHeight - 1` (matching use-stick-to-bottom)
 * — the `-1` provides a 1-px buffer to absorb sub-pixel rounding.
 */
function bottomScrollTop(scrollEl: HTMLElement): number {
	return Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight - 1);
}

/**
 * Compute the gap between current scroll position and the bottom.
 * Returns the distance in pixels. Zero or negative = at bottom.
 */
function bottomGap(scrollEl: HTMLElement): number {
	return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
}

// ============================================================================
// Hook
// ============================================================================

export function useAutoScrollPin(
	params: UseAutoScrollPinParams,
): UseAutoScrollPinResult {
	const { isActive, isSending } = params;

	// Public state — drives pill visibility and re-render of the consumer.
	const [isAtBottom, setIsAtBottomState] = useState(true);

	// Internal mutable state, kept in refs so they don't trigger re-renders.
	const scrollElRef = useRef<HTMLDivElement | null>(null);
	const contentElRef = useRef<HTMLDivElement | null>(null);
	const isAtBottomRef = useRef(true);
	const escapedFromLockRef = useRef(false);
	const scrollObserverRef = useRef<ResizeObserver | null>(null);
	const contentObserverRef = useRef<ResizeObserver | null>(null);
	/**
	 * Pending callback for the deferred initial-fire anchor (see I-S9 fix in
	 * contentRef below). The callback is fired by the MessageChannel on
	 * `initialDeferralChannelRef`; cleanup paths (contentRef detach, hook
	 * unmount) null this ref so a posted-but-not-yet-delivered message
	 * becomes a no-op.
	 *
	 * MessageChannel was chosen over `requestAnimationFrame` because rAF is
	 * folded into the same task when queued during an active frame-update
	 * cycle (Chromium's tab-activation path). Trace evidence:
	 * `_traces/Trace-Phase2-Verify-IS9-20260525T093852.json`. MessageChannel
	 * always queues a fresh task — it cannot be folded into the current one.
	 */
	const pendingInitialDeferralRef = useRef<(() => void) | null>(null);
	const initialDeferralChannelRef = useRef<MessageChannel | null>(null);
	const lastIsActiveRef = useRef(isActive);
	const lastIsSendingRef = useRef(isSending);
	/**
	 * Set to true immediately before the hook writes scrollTop itself
	 * (via setScrollTopInstant). Consumed and reset by the next
	 * handleScroll invocation. Closes I-S7: without this, the scroll
	 * event fired by the hook's own write can race with off-screen
	 * async resize-driven scrollHeight growth and be misinterpreted as
	 * a user-initiated scroll-up, flipping isAtBottomRef to false and
	 * preventing subsequent RO fires from re-anchoring.
	 *
	 * Each hook-driven scrollTop write produces exactly one scroll
	 * event (the browser fires once per programmatic write, even when
	 * the target value equals the current value — which clamps to 0).
	 * The next scroll event after the flag is set is therefore ours;
	 * the one after that is the user's.
	 */
	const ignoreNextScrollEventRef = useRef(false);

	/**
	 * Same-value bail wrapper around setIsAtBottomState (per spec
	 * Decision #2 / I31 lesson encoded as same-value bail). Streaming
	 * fires this many times per second; React must not re-render when
	 * the value hasn't actually changed.
	 */
	const setIsAtBottom = useCallback((next: boolean) => {
		if (isAtBottomRef.current === next) return;
		isAtBottomRef.current = next;
		setIsAtBottomState(next);
	}, []);

	const setEscapedFromLock = useCallback((next: boolean) => {
		if (escapedFromLockRef.current === next) return;
		escapedFromLockRef.current = next;
	}, []);

	/**
	 * Selection-vs-scroll discriminator (per spec Decision #21 Finding 4).
	 * Returns true if the user is currently dragging to select text inside
	 * the scroll container. Wheel/scroll events fired during selection drag
	 * are NOT treated as escape signals.
	 *
	 * Without this, every text-selection drag in a streaming bubble (copy
	 * code, quote response — frequent actions) would unpin the chat.
	 */
	const isSelecting = useCallback((): boolean => {
		if (!mouseDown) return false;
		if (typeof window === "undefined") return false;
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return false;
		const range = selection.getRangeAt(0);
		const scrollEl = scrollElRef.current;
		if (!scrollEl) return false;
		return (
			range.commonAncestorContainer.contains(scrollEl) ||
			scrollEl.contains(range.commonAncestorContainer)
		);
	}, []);

	/**
	 * Scroll the container to the bottom. The default behavior is "smooth"
	 * (CSS scroll-behavior: smooth), used for user-action paths like the
	 * pill click. "auto" uses the override pattern from Decision #22 to
	 * jump instantly even if CSS has a smooth default.
	 */
	const scrollToBottom = useCallback(
		(options?: { behavior?: "smooth" | "auto" }) => {
			const scrollEl = scrollElRef.current;
			if (!scrollEl) return;

			const behavior = options?.behavior ?? "smooth";
			const target = bottomScrollTop(scrollEl);

			if (behavior === "smooth") {
				// User-action path — let native CSS smooth-scroll handle the animation.
				// Read the computed style once; if it's not already 'smooth', set inline
				// for the duration of this call.
				const computed = getComputedStyle(scrollEl);
				if (computed.scrollBehavior !== "smooth") {
					// Decision #22: smooth-scroll path sets inline scroll-behavior
					// for the duration; the rule prefers CSS classes but this is
					// a per-call user-action override, not a static style.
					// eslint-disable-next-line obsidianmd/no-static-styles-assignment
					scrollEl.style.scrollBehavior = "smooth";
				}
				scrollEl.scrollTop = target;
			} else {
				ignoreNextScrollEventRef.current = true;
				setScrollTopInstant(scrollEl, target);
			}

			setIsAtBottom(true);
			setEscapedFromLock(false);
		},
		[setIsAtBottom, setEscapedFromLock],
	);

	/**
	 * Wheel handler. `deltaY < 0` (user scrolled up via wheel/trackpad)
	 * unpins. `deltaY > 0` is a no-op here — the scroll listener handles
	 * "user scrolled back near bottom" → re-pin.
	 *
	 * Suppressed during text-selection drag.
	 */
	const handleWheel = useCallback(
		(event: WheelEvent) => {
			if (event.deltaY >= 0) return;
			if (isSelecting()) return;
			const scrollEl = scrollElRef.current;
			if (!scrollEl) return;
			// Only treat as escape if the container actually scrolls (i.e.
			// content overflows the viewport). Otherwise wheel-up does nothing
			// visible and shouldn't toggle state.
			if (scrollEl.scrollHeight <= scrollEl.clientHeight) return;
			setEscapedFromLock(true);
			setIsAtBottom(false);
		},
		[isSelecting, setEscapedFromLock, setIsAtBottom],
	);

	/**
	 * Touch state for mobile escape detection (per spec Decision #21
	 * Finding 2; closes use-stick-to-bottom Issue #9 partially — iOS
	 * momentum scroll is genuinely hard, we accept good-enough).
	 *
	 * Mirrors wheel-up: drag-up gesture = escape.
	 */
	const touchStartYRef = useRef<number | null>(null);

	const handleTouchStart = useCallback((event: TouchEvent) => {
		const touch = event.touches[0];
		touchStartYRef.current = touch ? touch.clientY : null;
	}, []);

	const handleTouchMove = useCallback(
		(event: TouchEvent) => {
			const startY = touchStartYRef.current;
			if (startY === null) return;
			const touch = event.touches[0];
			if (!touch) return;
			const deltaY = touch.clientY - startY;
			// deltaY > 0 means finger dragged DOWN, which scrolls content UP
			// in standard touch-scroll convention. Threshold of 4 px filters
			// micro-jitter.
			if (deltaY <= 4) return;
			if (isSelecting()) return;
			const scrollEl = scrollElRef.current;
			if (!scrollEl) return;
			if (scrollEl.scrollHeight <= scrollEl.clientHeight) return;
			setEscapedFromLock(true);
			setIsAtBottom(false);
			touchStartYRef.current = null; // single fire per gesture
		},
		[isSelecting, setEscapedFromLock, setIsAtBottom],
	);

	/**
	 * Scroll handler. Fires on every scrollTop change (user-driven AND
	 * programmatic AND browser-synthesized). Only purpose here is to
	 * detect "user manually scrolled back near bottom" so the pill can
	 * disappear without a click — the inverse direction from wheel.
	 *
	 * The wheel handler handles "scrolled away" (escape).
	 */
	const handleScroll = useCallback(() => {
		// I-S7: a scroll event fired by the hook's own scrollTop write
		// must not be misinterpreted as a user scroll. The flag is set
		// synchronously before each setScrollTopInstant call; consume
		// and clear here.
		if (ignoreNextScrollEventRef.current) {
			ignoreNextScrollEventRef.current = false;
			return;
		}
		const scrollEl = scrollElRef.current;
		if (!scrollEl) return;
		const gap = bottomGap(scrollEl);
		const nearBottom = gap <= STICK_OFFSET_PX;

		if (nearBottom) {
			// User scrolled back near bottom (or programmatic scroll landed there)
			// — clear escape and re-pin.
			setEscapedFromLock(false);
			setIsAtBottom(true);
		} else if (
			!escapedFromLockRef.current &&
			isAtBottomRef.current &&
			gap > STICK_OFFSET_PX
		) {
			// We thought we were pinned but the browser settled scrollTop
			// outside the offset (e.g. content shrank). Update the public
			// boolean so the pill reflects truth, but don't set escape —
			// that's a user-intent signal only.
			setIsAtBottom(false);
		}
	}, [setEscapedFromLock, setIsAtBottom]);

	// ------------------------------------------------------------------------
	// scrollRef — RefCallback that attaches/detaches event listeners and
	// the container ResizeObserver (for container-shrink detection).
	// ------------------------------------------------------------------------
	const scrollRef: UseAutoScrollPinResult["scrollRef"] = useCallback(
		(el) => {
			ensureGlobalMouseListeners();

			// Detach from previous element if any
			const previous = scrollElRef.current;
			if (previous) {
				previous.removeEventListener("scroll", handleScroll);
				previous.removeEventListener("wheel", handleWheel);
				previous.removeEventListener("touchstart", handleTouchStart);
				previous.removeEventListener("touchmove", handleTouchMove);
				scrollObserverRef.current?.disconnect();
				scrollObserverRef.current = null;
			}

			scrollElRef.current = el;
			if (!el) return;

			// Listeners are passive — we never call preventDefault.
			el.addEventListener("scroll", handleScroll, { passive: true });
			el.addEventListener("wheel", handleWheel, { passive: true });
			el.addEventListener("touchstart", handleTouchStart, { passive: true });
			el.addEventListener("touchmove", handleTouchMove, { passive: true });

			// Container ResizeObserver — detects flex-sibling shrinks etc.
			// (per spec Decision #21 Finding 1, closes use-stick-to-bottom Issue #40).
			let prevContainerHeight: number | undefined;
			const observer = new ResizeObserver(([entry]) => {
				if (!entry) return;
				const { height } = entry.contentRect;
				const previous = prevContainerHeight;
				prevContainerHeight = height;

				// Only react to SHRINK while we're supposed to be pinned.
				// Container grow doesn't lose the bottom — content already
				// fills it (and contentRef ResizeObserver will fire too).
				if (previous === undefined) return;
				if (height >= previous) return;
				if (escapedFromLockRef.current) return;
				if (!isAtBottomRef.current) return;
				const scrollEl = scrollElRef.current;
				if (!scrollEl) return;
				ignoreNextScrollEventRef.current = true;
				setScrollTopInstant(scrollEl, bottomScrollTop(scrollEl));
			});
			observer.observe(el);
			scrollObserverRef.current = observer;
		},
		[handleScroll, handleWheel, handleTouchStart, handleTouchMove],
	);

	// ------------------------------------------------------------------------
	// contentRef — RefCallback that attaches/detaches the content
	// ResizeObserver (the primary "content grew, re-anchor" signal).
	// ------------------------------------------------------------------------
	const contentRef: UseAutoScrollPinResult["contentRef"] = useCallback(
		(el) => {
			contentObserverRef.current?.disconnect();
			contentObserverRef.current = null;
			// Drop any pending I-S9 deferred-anchor callback — the contentEl
			// it would write to may no longer be the current one. The
			// MessageChannel post may already be in flight; nulling the ref
			// turns the eventual fire into a no-op.
			pendingInitialDeferralRef.current = null;
			contentElRef.current = el;
			if (!el) return;

			let prevContentHeight: number | undefined;
			const observer = new ResizeObserver(([entry]) => {
				if (!entry) return;
				const { height } = entry.contentRect;
				const previous = prevContentHeight;
				prevContentHeight = height;

				const scrollEl = scrollElRef.current;
				if (!scrollEl) return;

				// Initial fire OR positive resize: anchor to bottom if pinned.
				// Treating the first fire the same as a subsequent grow is
				// load-bearing: during session restore, bubbles mount and
				// then asynchronously grow as markdown parses, syntax
				// highlighters finish, and code blocks measure. The first
				// ResizeObserver fire may report a PARTIAL height. The hook
				// must anchor on every positive height delta until the
				// bubbles stabilize. This works in concert with NOT using
				// content-visibility:auto on bubbles — that property
				// suppresses RO fires for off-screen growth, which would
				// silently leave the scroll at a partial position.
				const grew = previous === undefined || height > previous;
				const shrank = previous !== undefined && height < previous;

				if (grew) {
					if (escapedFromLockRef.current) return;
					if (!isAtBottomRef.current) return;

					// I-S9 fix (revised 2026-05-25 after T-IS9-smoke FAILED
					// against the original rAF-based deferral): the FIRST RO
					// fire happens during React's commit-phase microtask
					// flush on tab activation, when ~200 bubbles have just
					// mounted and the DOM is layout-dirty. A synchronous
					// read of scrollHeight here forces a partial-layout
					// pass against the dirty DOM (~31 ms on a 200-bubble
					// session pre-fix; ~75 ms with the broken rAF deferral
					// because rAF was folded into the same task). Trace
					// evidence:
					// _traces/Trace-Phase2-Verify-IS9-20260525T093852.json.
					//
					// Defer the read+write to a fresh task via a per-hook
					// MessageChannel post. Unlike rAF, MessageChannel cannot
					// be folded into the current task — the message always
					// queues a new task, escaping the click handler's task
					// even when the click was dispatched during an active
					// frame-update. Subsequent grows (true streaming chunks
					// with previous defined) write synchronously — the
					// dirty-DOM problem is only present on the just-mounted
					// initial fire.
					if (previous === undefined) {
						if (pendingInitialDeferralRef.current !== null) return;
						pendingInitialDeferralRef.current = () => {
							const el = scrollElRef.current;
							if (!el) return;
							// Re-check guards at fire time — state may have
							// changed between the RO callback and the
							// MessageChannel delivery (e.g., user wheel-up).
							if (escapedFromLockRef.current) return;
							if (!isAtBottomRef.current) return;
							ignoreNextScrollEventRef.current = true;
							setScrollTopInstant(el, bottomScrollTop(el));
						};
						// Lazy-create the channel on first use. Its onmessage
						// handler reads-and-clears pendingInitialDeferralRef,
						// so cleanup paths can cancel by nulling the ref.
						if (initialDeferralChannelRef.current === null) {
							const channel = new MessageChannel();
							channel.port1.onmessage = () => {
								const cb = pendingInitialDeferralRef.current;
								pendingInitialDeferralRef.current = null;
								if (cb) cb();
							};
							initialDeferralChannelRef.current = channel;
						}
						initialDeferralChannelRef.current.port2.postMessage(null);
						return;
					}

					ignoreNextScrollEventRef.current = true;
					setScrollTopInstant(scrollEl, bottomScrollTop(scrollEl));
				} else if (shrank) {
					// Content shrank. If the shrink brought the bottom back
					// into view (within STICK_OFFSET_PX), re-pin — even from
					// escaped state. Mirrors use-stick-to-bottom's negative-
					// resize branch (no escapedFromLock guard).
					if (bottomGap(scrollEl) <= STICK_OFFSET_PX) {
						setEscapedFromLock(false);
						setIsAtBottom(true);
					}
				}
			});
			observer.observe(el);
			contentObserverRef.current = observer;
		},
		[setIsAtBottom],
	);

	// ------------------------------------------------------------------------
	// isActive false → true: re-anchor if was pinned (closes I-S2/I-S3/I-S4
	// by architecture — no virtualizer cache to be stale)
	// ------------------------------------------------------------------------
	useEffect(() => {
		const previous = lastIsActiveRef.current;
		lastIsActiveRef.current = isActive;
		if (previous || !isActive) return; // only react to false → true
		if (escapedFromLockRef.current) return; // user was scrolled up; preserve
		if (!isAtBottomRef.current) return; // wasn't pinned; preserve
		const scrollEl = scrollElRef.current;
		if (!scrollEl) return;
		ignoreNextScrollEventRef.current = true;
		setScrollTopInstant(scrollEl, bottomScrollTop(scrollEl));
	}, [isActive]);

	// ------------------------------------------------------------------------
	// isSending false → true: user just submitted; smooth-scroll to bottom
	// ------------------------------------------------------------------------
	useEffect(() => {
		const previous = lastIsSendingRef.current;
		lastIsSendingRef.current = isSending;
		if (previous || !isSending) return; // only react to false → true
		setEscapedFromLock(false);
		scrollToBottom({ behavior: "smooth" });
	}, [isSending, scrollToBottom, setEscapedFromLock]);

	// ------------------------------------------------------------------------
	// Cleanup on unmount
	// ------------------------------------------------------------------------
	useEffect(() => {
		return () => {
			scrollObserverRef.current?.disconnect();
			contentObserverRef.current?.disconnect();
			scrollObserverRef.current = null;
			contentObserverRef.current = null;
			pendingInitialDeferralRef.current = null;
			if (initialDeferralChannelRef.current !== null) {
				// Closing the port stops further deliveries. Any message in
				// flight when this runs will be dropped by the browser.
				initialDeferralChannelRef.current.port1.close();
				initialDeferralChannelRef.current.port2.close();
				initialDeferralChannelRef.current = null;
			}
			const scrollEl = scrollElRef.current;
			if (scrollEl) {
				scrollEl.removeEventListener("scroll", handleScroll);
				scrollEl.removeEventListener("wheel", handleWheel);
				scrollEl.removeEventListener("touchstart", handleTouchStart);
				scrollEl.removeEventListener("touchmove", handleTouchMove);
			}
		};
		// Empty deps: run only on unmount. The scrollRef/contentRef callbacks
		// already handle re-attachment when the element changes.
	}, []);

	return useMemo(
		() => ({ scrollRef, contentRef, isAtBottom, scrollToBottom }),
		[scrollRef, contentRef, isAtBottom, scrollToBottom],
	);
}
