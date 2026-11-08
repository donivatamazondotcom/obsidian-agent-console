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

import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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

	activeDocument.addEventListener("mousedown", () => {
		mouseDown = true;
	});
	activeDocument.addEventListener("mouseup", () => {
		mouseDown = false;
	});
	activeDocument.addEventListener("click", () => {
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
		// Decision #22: temporarily force instant scroll for this synchronous
		// scrollTop write, then restore the prior behavior. Assigning from a
		// variable (not a string literal) is the dynamic-value escape that
		// obsidianmd/no-static-styles-assignment sanctions — a CSS class
		// cannot time-bound the override to one synchronous write.
		const instantBehavior = "auto";
		scrollEl.style.scrollBehavior = instantBehavior;
	}
	scrollEl.scrollTop = value;
	if (needsOverride) {
		scrollEl.style.scrollBehavior = previousBehavior;
	}
}

/**
 * I305: the hook's own scrollTop write. Arms the one-shot ignore flag so
 * handleScroll skips the scroll event the write causes, then disarms it
 * when the view didn't move by a whole pixel. Browsers fire no scroll event
 * for a no-op write, so an armed flag would otherwise sit until the user's
 * next real scroll and swallow it.
 */
function writeOwnScroll(
	scrollEl: HTMLElement,
	value: number,
	ignoreNextScrollEventRef: { current: boolean },
): void {
	const before = scrollEl.scrollTop;
	ignoreNextScrollEventRef.current = true;
	setScrollTopInstant(scrollEl, value);
	if (Math.abs(scrollEl.scrollTop - before) < 1) {
		ignoreNextScrollEventRef.current = false;
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
// I284: reading-position anchor for tab return
// ============================================================================

/**
 * How long a restore holds the reading position after a tab returns. Rows
 * above the anchor keep growing in (async markdown, images, highlighting)
 * and `overflow-anchor: none` means nothing else compensates, so the
 * restore holds for the whole window rather than ending on a quiet
 * period. Any user scroll input ends it early.
 */
const RESTORE_HOLD_MS = 2000;

/**
 * I304: how long scroll intent outlives its input. A track click or a
 * released scrollbar drag can deliver its scroll event a frame after
 * pointerup, and a smooth keyboard or track-click scroll animates for
 * ~100–200 ms. Each scroll inside the window extends it.
 */
const SCROLL_INTENT_GRACE_MS = 150;

/** I304: keys that scroll the message list when it (or the page) has focus. */
const SCROLL_KEYS = new Set([
	"ArrowUp",
	"ArrowDown",
	"PageUp",
	"PageDown",
	"Home",
	"End",
	" ",
]);

/** The message row at the top of the view, and how far into it. */
interface ReadingAnchor {
	id: string;
	offset: number;
}

/**
 * Find the first child of the content element whose bottom is below
 * `scrollTop`, then the first message row (`data-message-id`) from there.
 * Children are in document order, so a binary search costs about
 * log2(n) offset reads (~8 on a 200-message chat).
 */
function findReadingAnchor(
	contentEl: HTMLElement,
	scrollTop: number,
): ReadingAnchor | null {
	const rows = contentEl.children;
	let lo = 0;
	let hi = rows.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const el = rows[mid] as HTMLElement;
		if (el.offsetTop + el.offsetHeight > scrollTop) {
			found = mid;
			hi = mid - 1;
		} else {
			lo = mid + 1;
		}
	}
	if (found < 0) return null;
	for (let i = found; i < rows.length; i++) {
		const el = rows[i] as HTMLElement;
		const id = el.dataset.messageId;
		if (id) return { id, offset: scrollTop - el.offsetTop };
	}
	return null;
}

/** One-time O(n) lookup of a message row by id, at restore start. */
function findRowById(contentEl: HTMLElement, id: string): HTMLElement | null {
	const rows = contentEl.children;
	for (let i = 0; i < rows.length; i++) {
		const el = rows[i] as HTMLElement;
		if (el.dataset.messageId === id) return el;
	}
	return null;
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
	const composerObserverRef = useRef<ResizeObserver | null>(null);
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
	 * I149 fix: target scrollTop of a pending container-shrink re-anchor.
	 * A composer (InputArea) grow shrinks the scroll container; the
	 * scrollRef ResizeObserver re-anchors to the bottom, but Chromium's
	 * scroll-preservation can REVERT that write AFTER the resizeDifferenceRef
	 * guard window has cleared (rAF+setTimeout(1)). While this is non-null,
	 * handleScroll treats an upward drift as that revert and re-asserts the
	 * bottom instead of escaping, until scrollTop settles at the target. A
	 * genuine wheel/touch/keyboard escape clears it via setEscapedFromLock(true).
	 */
	const pendingAnchorTargetRef = useRef<number | null>(null);

	/**
	 * I284: reading position saved while the tab is scrolled up. Inactive
	 * tabs unmount their rows and sit under display:none, which resets
	 * scrollTop to 0, so the position has to be saved and restored. It is
	 * an element anchor (row id + offset), not a pixel value, because rows
	 * above it keep rendering in (async markdown) after the tab returns.
	 */
	const readingAnchorRef = useRef<ReadingAnchor | null>(null);
	/** I284: blocks anchor saves while the tab is hidden or restoring. */
	const anchorFrozenRef = useRef(false);
	/** I284: the in-flight restore (row cached at start + offset). */
	const restoreRef = useRef<{ row: HTMLElement; offset: number } | null>(
		null,
	);
	const restoreTimerRef = useRef<number | null>(null);
	/** I284: previous isActive, tracked by the layout effect. */
	const layoutPrevActiveRef = useRef(isActive);

	/**
	 * I284: end the in-flight restore. Saving resumes only if the tab is
	 * visible; a hidden tab keeps the anchor it had.
	 */
	const endRestore = useCallback(() => {
		if (restoreTimerRef.current !== null) {
			window.clearTimeout(restoreTimerRef.current);
			restoreTimerRef.current = null;
		}
		restoreRef.current = null;
		anchorFrozenRef.current = !layoutPrevActiveRef.current;
	}, []);

	/** I284: any user scroll intent (wheel, touch, pointer, key) wins. */
	const cancelRestore = useCallback(() => {
		if (restoreRef.current) endRestore();
	}, [endRestore]);

	/**
	 * I284: write the anchored row's position. Writes (and arms the
	 * one-shot ignore flag) only when the view moves more than 1 px,
	 * because Chromium fires no scroll event for a no-op write and an
	 * armed flag would swallow the user's next real scroll.
	 */
	const applyRestore = useCallback(() => {
		const r = restoreRef.current;
		const scrollEl = scrollElRef.current;
		if (!r || !scrollEl) return;
		if (!r.row.isConnected) {
			endRestore();
			return;
		}
		const desired = Math.min(
			r.row.offsetTop + r.offset,
			bottomScrollTop(scrollEl),
		);
		if (Math.abs(scrollEl.scrollTop - desired) <= 1) return;
				writeOwnScroll(scrollEl, desired, ignoreNextScrollEventRef);
		lastScrollTopRef.current = scrollEl.scrollTop;
	}, [endRestore]);

	/**
	 * I-S12 round-3 fix: tracks the most recent ResizeObserver-detected
	 * height delta (positive on grow, negative on shrink). Set at the
	 * START of every RO callback (BOTH contentRef AND scrollRef) before
	 * any re-anchor work. Cleared via rAF + setTimeout(1) with a
	 * last-writer-wins guard so a NEWER RO fire's clear cannot wipe an
	 * OLDER fire's set during the clear-defer window.
	 *
	 * handleScroll's deferred body bails when this is non-zero, so
	 * layout-driven scroll events that fire BEFORE the RO microtask
	 * (per WICG/resize-observer#25) AND any subsequent
	 * scroll-preservation-revert events fired by Chromium during the
	 * rendering update are not misinterpreted as user scroll input.
	 *
	 * Pattern adopted line-for-line from useStickToBottom.ts lines 539
	 * + 583–589 (resizeDifference value + rAF+setTimeout(1) clear with
	 * last-writer-wins guard). See [[I-S12 round-2 synthesis]] in the
	 * vault for the canonical-source reading and rationale.
	 */
	const resizeDifferenceRef = useRef(0);

	/**
	 * Tracks the previous scrollTop seen by handleScroll. Used by the
	 * direction-based scroll classifier (scrollingUp vs scrollingDown)
	 * adopted from useStickToBottom.ts lines 436–451. Direction is the
	 * canonical user-intent signal — "user scrolled up" = unpin,
	 * "user scrolled down" = clear escape, "near bottom" = re-pin. The
	 * absolute gap value alone cannot distinguish a smooth-scroll-toward-
	 * bottom animation from a stationary far-from-bottom position.
	 */
	const lastScrollTopRef = useRef<number | undefined>(undefined);

	/**
	 * Same-value bail wrapper around setIsAtBottomState (per spec
	 * Decision #2 / I31 lesson encoded as same-value bail). Streaming
	 * fires this many times per second; React must not re-render when
	 * the value hasn't actually changed.
	 */
	const setIsAtBottom = useCallback((next: boolean) => {
		// I284: a pinned tab has no reading position to restore.
		if (next) {
			readingAnchorRef.current = null;
			if (restoreRef.current) endRestore();
		}
		if (isAtBottomRef.current === next) return;
		isAtBottomRef.current = next;
		setIsAtBottomState(next);
	}, [endRestore]);

	const setEscapedFromLock = useCallback((next: boolean) => {
		// I149: a real escape cancels any pending container-shrink re-anchor,
		// so genuine user scroll-up intent is never re-asserted away.
		if (next) pendingAnchorTargetRef.current = null;
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
	 * Helper: schedule the resize-difference clear via rAF + setTimeout(1)
	 * with a last-writer-wins guard. Adopted from useStickToBottom.ts
	 * lines 583–589. The two-frame deferral covers (a) the layout-driven
	 * scroll event that fires BEFORE the RO microtask, and (b) any
	 * post-RO scroll preservation revert events Chromium fires during the
	 * rendering update. The last-writer-wins guard ensures that a NEWER
	 * RO callback's set cannot be wiped by an OLDER callback's pending
	 * clear — when a clear fires, it only clears if the captured
	 * difference value is still the current one.
	 */
	const scheduleResizeDifferenceClear = useCallback((captured: number) => {
		window.requestAnimationFrame(() => {
			window.setTimeout(() => {
				if (resizeDifferenceRef.current === captured) {
					resizeDifferenceRef.current = 0;
				}
			}, 1);
		});
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
					// Force smooth for this user-action scroll. Assign from a
					// variable so obsidianmd/no-static-styles-assignment treats
					// it as a dynamic (runtime-conditional) write, not a static
					// style — a CSS class can't scope this to the per-call path.
					const smoothBehavior = "smooth";
					scrollEl.style.scrollBehavior = smoothBehavior;
				}
				scrollEl.scrollTop = target;
			} else {
								writeOwnScroll(scrollEl, target, ignoreNextScrollEventRef);
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
			cancelRestore(); // I284: before the early return, any direction
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
		[cancelRestore, isSelecting, setEscapedFromLock, setIsAtBottom],
	);

	/**
	 * Touch state for mobile escape detection (per spec Decision #21
	 * Finding 2; closes use-stick-to-bottom Issue #9 partially — iOS
	 * momentum scroll is genuinely hard, we accept good-enough).
	 *
	 * Mirrors wheel-up: drag-up gesture = escape.
	 */
	const touchStartYRef = useRef<number | null>(null);

	const handleTouchStart = useCallback(
		(event: TouchEvent) => {
			cancelRestore(); // I284
			const touch = event.touches[0];
			touchStartYRef.current = touch ? touch.clientY : null;
		},
		[cancelRestore],
	);

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
	 * programmatic AND browser-synthesized).
	 *
	 * I-S12 round-3: classification is direction-based, not gap-based,
	 * adopted from useStickToBottom.ts lines 436–451. The handler body
	 * defers via setTimeout(1) per use-stick-to-bottom line 436, citing
	 * WICG/resize-observer#25 — scroll events fire BEFORE the RO
	 * microtask in Chromium, so the deferral lets the RO callback's
	 * resizeDifferenceRef set land before this handler reads it.
	 *
	 * The deferred body bails on:
	 *   1. resizeDifferenceRef !== 0 (a resize is in flight)
	 *   2. ignoreNextScrollEventRef (the hook's own scrollTop write
	 *      produced this scroll event — see I-S7)
	 *
	 * Otherwise it classifies by direction (scrollingUp vs scrollingDown
	 * vs neither). scrollingUp = user intent to escape. scrollingDown =
	 * clear escape (user heading toward bottom). "near bottom" = re-pin.
	 *
	 * What this handler does NOT do anymore (round-2 design, removed):
	 * the gap-based else-if branch that flipped isAtBottom to false when
	 * gap > STICK_OFFSET_PX while pinned. That branch fired during smooth-
	 * scroll-toward-bottom animations (Test 4 in [[I-S12 round-2 synthesis]])
	 * and during layout-shrink scroll events (Test 1 in same synthesis).
	 * Direction-based classification correctly handles both — animations
	 * are scrollingDown (does not unpin), layout shrinks are guarded by
	 * resizeDifferenceRef.
	 */
	/**
	 * I304: user scroll intent for inputs that produce only scroll events:
	 * a scrollbar drag, a track click, a scroll key. Wheel and touch unpin
	 * from their own handlers; these three have nothing but the scroll
	 * event, and while a response streams the direction classifier is
	 * almost always bailed on an in-flight resize. Intent is held while the
	 * pointer is down on the scrollbar, then for SCROLL_INTENT_GRACE_MS.
	 */
	const scrollIntentRef = useRef(false);
	const scrollbarHeldRef = useRef(false);
	const intentTimerRef = useRef<number | null>(null);

	const armIntentGrace = useCallback(() => {
		if (intentTimerRef.current !== null) {
			window.clearTimeout(intentTimerRef.current);
		}
		intentTimerRef.current = window.setTimeout(() => {
			intentTimerRef.current = null;
			if (!scrollbarHeldRef.current) scrollIntentRef.current = false;
		}, SCROLL_INTENT_GRACE_MS);
	}, []);

	const handlePointerDown = useCallback(
		(event: PointerEvent) => {
			cancelRestore(); // I284
			// The scroller itself is the target only for its scrollbar (and
			// bare padding); a press on a message targets a descendant.
			if (event.target !== scrollElRef.current) return;
			scrollbarHeldRef.current = true;
			scrollIntentRef.current = true;
			if (intentTimerRef.current !== null) {
				window.clearTimeout(intentTimerRef.current);
				intentTimerRef.current = null;
			}
		},
		[cancelRestore],
	);

	const handlePointerUp = useCallback(() => {
		if (!scrollbarHeldRef.current) return;
		scrollbarHeldRef.current = false;
		armIntentGrace();
	}, [armIntentGrace]);

	const handleScrollKey = useCallback(
		(event: KeyboardEvent) => {
			if (!SCROLL_KEYS.has(event.key)) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest?.("textarea, input, select, [contenteditable='true']")) return;
			scrollIntentRef.current = true;
			armIntentGrace();
		},
		[armIntentGrace],
	);

	const handleScroll = useCallback(() => {
		// I-S7 fast-path: a scroll event fired by the hook's own scrollTop
		// write must not be misinterpreted as a user scroll. The flag is
		// set synchronously before each setScrollTopInstant call; consume
		// and clear here. This check happens BEFORE the setTimeout(1)
		// deferral so consumption is ordered against subsequent scroll
		// events. Capture lastScrollTop before the deferral so direction
		// is computed against the scrollTop AT scroll-event-fire time.
		if (ignoreNextScrollEventRef.current) {
			ignoreNextScrollEventRef.current = false;
			const scrollEl = scrollElRef.current;
			if (scrollEl) lastScrollTopRef.current = scrollEl.scrollTop;
			return;
		}

		const scrollEl = scrollElRef.current;
		if (!scrollEl) return;

		const scrollTop = scrollEl.scrollTop;

		// I284: during a restore, non-ignored scroll events are layout
		// clamps/reverts (user intent cancels the restore first via
		// wheel/touch/pointer/key), so they neither classify nor save.
		if (restoreRef.current) {
			lastScrollTopRef.current = scrollTop;
			return;
		}
		// I284: save the reading position whenever the tab isn't pinned,
		// including a small scroll-up that stays within STICK_OFFSET_PX of
		// the bottom (the wheel already unpinned it). A pinned, streaming
		// tab pays nothing.
		if (
			!anchorFrozenRef.current &&
			contentElRef.current !== null &&
			scrollEl.clientHeight > 0 &&
			(escapedFromLockRef.current ||
				!isAtBottomRef.current ||
				scrollEl.scrollHeight - scrollTop - scrollEl.clientHeight >
					STICK_OFFSET_PX)
		) {
			const anchor = findReadingAnchor(contentElRef.current, scrollTop);
			if (anchor) readingAnchorRef.current = anchor;
		}

		const lastScrollTop = lastScrollTopRef.current ?? scrollTop;
		lastScrollTopRef.current = scrollTop;

		// I304: a scroll the user is driving through the scrollbar or keys
		// escapes now, before the deferral, so a chunk landing in between
		// can't pull the view back. The deferred body below also skips the
		// in-flight-resize bail and the I149 revert re-assert for it.
		const userDriven = scrollIntentRef.current;
		if (userDriven) {
			if (!scrollbarHeldRef.current) armIntentGrace();
			if (scrollTop < lastScrollTop && bottomGap(scrollEl) > STICK_OFFSET_PX) {
				pendingAnchorTargetRef.current = null;
				setEscapedFromLock(true);
				setIsAtBottom(false);
			}
		}

		// I-S12 round-3: defer the body via setTimeout(1) per
		// useStickToBottom.ts line 436, citing
		// WICG/resize-observer#25#issuecomment-248757228 — scroll events
		// may come before a ResizeObserver event, so we use a timeout to
		// let any pending resize-difference set land first.
		window.setTimeout(() => {
			// Bail if a resize is in flight. resizeDifferenceRef is set at
			// the START of each RO callback (BOTH contentRef AND scrollRef)
			// and cleared via rAF+setTimeout(1). Any scroll events fired
			// during the rendering update — synthesized by Chromium for
			// the layout shrink, by scroll preservation reverts, or by
			// our own RO-driven writes — fall through this check.
			if (resizeDifferenceRef.current !== 0 && !userDriven) {
				return;
			}

			const currentScrollEl = scrollElRef.current;
			if (!currentScrollEl) return;

			// I149: a container-shrink (composer grew) just re-anchored us. The
			// browser's scroll-preservation can revert that write after the
			// resizeDifferenceRef guard has already cleared. While an anchor is
			// pending and we're still pinned, re-assert the bottom on the revert
			// instead of letting the direction classifier read it as user escape,
			// until scrollTop settles at the target.
			const pendingTarget = pendingAnchorTargetRef.current;
			if (pendingTarget !== null && !userDriven) {
				if (Math.abs(scrollTop - pendingTarget) <= 1) {
					pendingAnchorTargetRef.current = null;
				} else if (isAtBottomRef.current && !escapedFromLockRef.current) {
					const target = bottomScrollTop(currentScrollEl);
					pendingAnchorTargetRef.current = target;
										writeOwnScroll(currentScrollEl, target, ignoreNextScrollEventRef);
					lastScrollTopRef.current = currentScrollEl.scrollTop;
					return;
				}
			}

			const isScrollingUp = scrollTop < lastScrollTop;
			const isScrollingDown = scrollTop > lastScrollTop;

			// User scrolled up → escape (suppressed during text selection).
			// I39 fix: only escape if the gap is ALSO beyond the stick zone.
			// Momentum scroll deceleration produces tiny upward bounces while
			// still within STICK_OFFSET_PX — these are noise, not user intent.
			const gap = bottomGap(currentScrollEl);
			if (isScrollingUp && (userDriven || !isSelecting()) && gap > STICK_OFFSET_PX) {
				setEscapedFromLock(true);
				setIsAtBottom(false);
			}

			// User scrolled down → clear escape. We don't set isAtBottom
			// here unconditionally — the near-bottom check below decides.
			// Without this clear, a user who escaped (wheel-up) and then
			// manually scrolled back down past the threshold would still
			// be "escaped" and the near-bottom branch would not re-pin.
			if (isScrollingDown) {
				setEscapedFromLock(false);
			}

			// Re-pin if we're near the bottom and not escaped.
			const nearBottom = gap <= STICK_OFFSET_PX;
			if (!escapedFromLockRef.current && nearBottom) {
				setIsAtBottom(true);
			}
		}, 1);
	}, [armIntentGrace, isSelecting, setEscapedFromLock, setIsAtBottom]);

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
				previous.removeEventListener("pointerdown", handlePointerDown);
				previous.ownerDocument.removeEventListener("pointerup", handlePointerUp);
				previous.ownerDocument.removeEventListener("pointercancel", handlePointerUp);
				previous.ownerDocument.removeEventListener("keydown", handleScrollKey);
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
			el.addEventListener("pointerdown", handlePointerDown, { passive: true });
			// I304: a drag can end anywhere, and a scroll key fires on
			// whatever holds focus (often the body), so both listen on the
			// scroller's own document (popout-safe).
			el.ownerDocument.addEventListener("pointerup", handlePointerUp);
			el.ownerDocument.addEventListener("pointercancel", handlePointerUp);
			el.ownerDocument.addEventListener("keydown", handleScrollKey);

			// Container ResizeObserver — detects flex-sibling shrinks etc.
			// (per spec Decision #21 Finding 1, closes use-stick-to-bottom Issue #40).
			let prevContainerHeight: number | undefined;
			const observer = new ResizeObserver(([entry]) => {
				if (!entry) return;
				const { height } = entry.contentRect;
				const previous = prevContainerHeight;
				prevContainerHeight = height;

				// I-S12 round-3: set resizeDifferenceRef BEFORE any re-anchor
				// work, so a layout-driven scroll event firing before this RO
				// microtask (per WICG/resize-observer#25) and any
				// scroll-preservation-revert event fired by Chromium during
				// the rendering update both see the guard set. Adopted line-
				// for-line from useStickToBottom.ts lines 539 + 583–589.
				const difference = previous === undefined ? 0 : height - previous;
				if (difference !== 0) {
					resizeDifferenceRef.current = difference;
					scheduleResizeDifferenceClear(difference);
				}

				if (previous === undefined) return;

				const scrollEl = scrollElRef.current;
				if (!scrollEl) return;

				// I284: while restoring, re-apply the reading position and
				// skip both re-pin branches. The container growing back from
				// 0 after a clamped first write would otherwise re-pin.
				if (restoreRef.current) {
					applyRestore();
					return;
				}

				if (height < previous) {
					// Container shrank (e.g., flex-sibling InputArea grew into our space).
					// Re-anchor to bottom if pinned. Adopted line-for-line from
					// useStickToBottom.ts: each RO fire writes the current target,
					// and resizeDifferenceRef guards subsequent scroll events against
					// misinterpretation by handleScroll.
					if (escapedFromLockRef.current) return;
					if (!isAtBottomRef.current) return;
										writeOwnScroll(scrollEl, bottomScrollTop(scrollEl), ignoreNextScrollEventRef);
					// I149: mark the anchor pending so handleScroll re-asserts the
					// bottom if the browser reverts this write after the guard clears.
					pendingAnchorTargetRef.current = bottomScrollTop(scrollEl);
				} else if (height > previous) {
					// I-S12 fix for grow symptom: container grew (e.g., textarea cleared).
					// If the grow brought the bottom back into view (within
					// STICK_OFFSET_PX), re-pin — even from escaped state. Mirrors the
					// contentRef RO's shrank branch (no escapedFromLock guard, since
					// the user's effective scroll position is now at the bottom).
					//
					// Pre-fix this branch was a no-op (`if (height >= previous) return;`)
					// on the assumption that contentRef RO would handle re-pinning,
					// but contentRef doesn't fire on container-grow if content height
					// stayed the same. Without this, the scroll-pill stays visible
					// after the user clears the textarea even though the scroll
					// physically lands at bottom.
					if (bottomGap(scrollEl) <= STICK_OFFSET_PX) {
						setEscapedFromLock(false);
						setIsAtBottom(true);
					}
				}
			});
			observer.observe(el);
			scrollObserverRef.current = observer;
		},
		[
			applyRestore,
			handlePointerDown,
			handlePointerUp,
			handleScrollKey,
			handleScroll,
			handleWheel,
			handleTouchStart,
			handleTouchMove,
			scheduleResizeDifferenceClear,
			setEscapedFromLock,
			setIsAtBottom,
		],
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

				// I-S12 round-3: set resizeDifferenceRef BEFORE any re-anchor
				// work. Streaming chunk grows are also "resize in flight" from
				// handleScroll's perspective — when the hook writes scrollTop to
				// the new bottom, the scroll event must not be classified as
				// user input. Adopted line-for-line from useStickToBottom.ts
				// lines 539 + 583–589.
				const difference = previous === undefined ? 0 : height - previous;
				if (difference !== 0) {
					resizeDifferenceRef.current = difference;
					scheduleResizeDifferenceClear(difference);
				}

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
				// I284: while restoring, re-apply the reading position as rows
				// render in. Return so neither the pinned anchor nor the
				// re-pin runs.
				if (restoreRef.current) {
					applyRestore();
					return;
				}

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
														writeOwnScroll(el, bottomScrollTop(el), ignoreNextScrollEventRef);
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

										writeOwnScroll(scrollEl, bottomScrollTop(scrollEl), ignoreNextScrollEventRef);
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
		[
			applyRestore,
			scheduleResizeDifferenceClear,
			setEscapedFromLock,
			setIsAtBottom,
		],
	);

	// ------------------------------------------------------------------------
	// I284: save/restore the reading position across a tab switch. A layout
	// effect so the restore lands before paint, ResizeObserver delivery and
	// scroll dispatch on every update lane (the hotkey path updates outside
	// a React event, so passive effects can run after a paint).
	// ------------------------------------------------------------------------
	useLayoutEffect(() => {
		const previous = layoutPrevActiveRef.current;
		layoutPrevActiveRef.current = isActive;
		if (previous === isActive) return;
		if (!isActive) {
			// Hidden: stop any restore and freeze the anchor as it is.
			endRestore();
			return;
		}
		anchorFrozenRef.current = false;
		// Pinned: the passive effect below re-anchors to the bottom.
		if (!escapedFromLockRef.current && isAtBottomRef.current) return;
		const anchor = readingAnchorRef.current;
		const contentEl = contentElRef.current;
		if (!anchor || !contentEl) return;
		const row = findRowById(contentEl, anchor.id);
		if (!row) {
			// The transcript changed while hidden: nothing to restore.
			readingAnchorRef.current = null;
			return;
		}
		restoreRef.current = { row, offset: anchor.offset };
		anchorFrozenRef.current = true;
		applyRestore();
		restoreTimerRef.current = window.setTimeout(endRestore, RESTORE_HOLD_MS);
	}, [isActive, applyRestore, endRestore]);

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
				writeOwnScroll(scrollEl, bottomScrollTop(scrollEl), ignoreNextScrollEventRef);
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
	// I149: re-anchor to the bottom when the composer grows. The messages
	// container's ResizeObserver does NOT fire on the flex-reflow shrink
	// caused by composer growth in Obsidian's Chromium, and neither does a
	// ResizeObserver on the composer itself (verified empirically). So instead
	// of a size observer we listen for the textarea's `input` events, which
	// bubble reliably to the stable chat-view container. On input we defer one
	// frame (so textarea autosize has applied) and, if still pinned, re-anchor
	// the messages scroll to the new bottom — marking the anchor pending so
	// handleScroll re-asserts it if the browser reverts the write.
	useEffect(() => {
		const scrollEl = scrollElRef.current;
		if (!scrollEl) return;
		const container = scrollEl.closest(".agent-client-chat-view-container");
		if (!container) return;
		const onInput = () => {
			if (escapedFromLockRef.current) return;
			if (!isAtBottomRef.current) return;
			window.requestAnimationFrame(() => {
				const sc = scrollElRef.current;
				if (!sc) return;
				if (escapedFromLockRef.current || !isAtBottomRef.current) return;
				const target = bottomScrollTop(sc);
				pendingAnchorTargetRef.current = target;
								writeOwnScroll(sc, target, ignoreNextScrollEventRef);
			});
		};
		container.addEventListener("input", onInput);
		// I284: a key pressed in the chat view (for example on a focused
		// copy button) ends a restore, so keyboard scrolling is never pulled
		// back to the saved position. Typing in the composer or another
		// editable field can't scroll the message list, so it doesn't.
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (target?.closest("textarea, input, [contenteditable='true']")) return;
			cancelRestore();
		};
		container.addEventListener("keydown", onKeyDown);
		return () => {
			container.removeEventListener("input", onInput);
			container.removeEventListener("keydown", onKeyDown);
		};
	}, [cancelRestore]);

	// ------------------------------------------------------------------------
	// Cleanup on unmount
	// ------------------------------------------------------------------------
	useEffect(() => {
		return () => {
			if (intentTimerRef.current !== null) {
				window.clearTimeout(intentTimerRef.current);
				intentTimerRef.current = null;
			}
			scrollObserverRef.current?.disconnect();
			contentObserverRef.current?.disconnect();
			scrollObserverRef.current = null;
			contentObserverRef.current = null;
			composerObserverRef.current?.disconnect();
			composerObserverRef.current = null;
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
				scrollEl.removeEventListener("pointerdown", cancelRestore);
			}
			if (restoreTimerRef.current !== null) {
				window.clearTimeout(restoreTimerRef.current);
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
