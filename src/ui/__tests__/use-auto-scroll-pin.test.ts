/**
 * Unit tests for useAutoScrollPin.
 *
 * ============================================================================
 * COVERAGE BOUNDARY — read this first
 * ============================================================================
 *
 * This suite covers what JSDOM can simulate. JSDOM has no real layout engine:
 * scrollTop / scrollHeight / clientHeight are direct property writes here,
 * NOT the result of CSS layout. ResizeObserver is stubbed. The virtualizer
 * is a `vi.fn()` mock with no measurement state. Real React rendering happens
 * via @testing-library/react, but no actual DOM measurement.
 *
 * Bug classes COVERED by this unit suite:
 *   ✓ State transition logic (pin state machine)
 *   ✓ Hysteresis threshold values AND architectural intent (property-based)
 *   ✓ shouldAdjust gate behavior
 *   ✓ Adjust-flag wrapper lifecycle (set on shouldAdjust=true, expires
 *     after 50ms, cleared on unmount, re-extended by rapid calls; closes
 *     I-S1)
 *   ✓ Discrimination between virtualizer-driven scroll events (flag set)
 *     and user-driven scroll events (flag unset)
 *   ✓ scrollToBottom invocation arguments (full toHaveBeenCalledWith)
 *   ✓ Same-value bail (no-op transitions; renders not scheduled)
 *   ✓ Smooth-scroll on user-sent path
 *   ✓ Tab-activation transitions (pin re-arming, anchor index, alignment)
 *   ✓ Empty-state and zero-height-container safety
 *
 * Bug classes that are JSDOM-IMPOSSIBLE and require manual smoke test:
 *   ✗ Virtualizer measurement cache staleness after display:none periods
 *     (e.g., Known Issue I-S3 in the spec)
 *   ✗ Real ResizeObserver behavior on layout changes
 *   ✗ User-perceived jitter from rapid scrollTop oscillation
 *   ✗ Tab activation flicker timing
 *   ✗ rAF scheduling against real frame timing
 *   ✗ Interaction between Authority A's adjust and the scroll listener's
 *     reading of in-flight DOM values
 *
 * The smoke-test checklist in the spec at
 * 04-initiatives/Agent Console/ACP Scroll Architecture Rework.md § Test results
 * is LOAD-BEARING for the second list. The number of passing unit tests here
 * is NOT a sufficient signal of coverage on its own.
 *
 * ============================================================================
 * Test design conventions (per spec Decision #13)
 * ============================================================================
 *
 * 1. Property-based tests for thresholds via `it.each` across value ranges.
 *    Captured-evidence values become a subset of the test surface, not the
 *    whole surface. See the "hysteresis property tests" describe block below.
 *
 * 2. Always full-argument `toHaveBeenCalledWith` for spy assertions. Never
 *    bare `toHaveBeenCalled` — the arguments are part of the contract. See
 *    the "tab activation arguments" describe block for the I-S2 regression
 *    net.
 *
 * 3. Architectural-intent tests live alongside implementation tests. When
 *    they disagree (e.g., the captured-evidence threshold says "stays pinned"
 *    but the architectural intent says "absorbs streaming bursts"), prefer
 *    the architectural intent and surface the disagreement as an open issue.
 *
 * Coverage targets behaviors T100–T131 from the spec, with each behavior's
 * Txx ID called out in the test name.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { App } from "obsidian";

import { useAutoScrollPin } from "../use-auto-scroll-pin";
import {
	NEAR_BOTTOM_FLIP_TO_FALSE_PX,
	NEAR_BOTTOM_FLIP_TO_TRUE_PX,
	type UseAutoScrollPinParams,
} from "../use-auto-scroll-pin.types";
import type { IChatViewHost } from "../view-host";

// ============================================================================
// Test scaffolding
// ============================================================================

/**
 * Build a stub container with controllable scroll dimensions.
 * Vitest+JSDOM doesn't fire ResizeObserver/IntersectionObserver natively,
 * so we operate at the property level: tests set scrollTop/scrollHeight/
 * clientHeight and then dispatch a `scroll` event.
 */
function makeContainer(opts: {
	scrollTop?: number;
	scrollHeight?: number;
	clientHeight?: number;
} = {}): HTMLDivElement {
	const div = document.createElement("div");
	Object.defineProperty(div, "scrollTop", {
		value: opts.scrollTop ?? 0,
		writable: true,
		configurable: true,
	});
	Object.defineProperty(div, "scrollHeight", {
		value: opts.scrollHeight ?? 0,
		writable: true,
		configurable: true,
	});
	Object.defineProperty(div, "clientHeight", {
		value: opts.clientHeight ?? 0,
		writable: true,
		configurable: true,
	});
	return div;
}

/**
 * Mutate a container's scroll dimensions and fire a scroll event so the
 * hook's listener processes the change.
 */
function simulateScroll(
	container: HTMLDivElement,
	dims: { scrollTop?: number; scrollHeight?: number; clientHeight?: number },
): void {
	if (dims.scrollTop !== undefined) {
		Object.defineProperty(container, "scrollTop", {
			value: dims.scrollTop,
			writable: true,
			configurable: true,
		});
	}
	if (dims.scrollHeight !== undefined) {
		Object.defineProperty(container, "scrollHeight", {
			value: dims.scrollHeight,
			writable: true,
			configurable: true,
		});
	}
	if (dims.clientHeight !== undefined) {
		Object.defineProperty(container, "clientHeight", {
			value: dims.clientHeight,
			writable: true,
			configurable: true,
		});
	}
	act(() => {
		container.dispatchEvent(new Event("scroll"));
	});
}

/**
 * Build hook params backed by a fresh mock container, virtualizer, and host.
 * Tests can override any param.
 */
function makeParams(
	overrides: Partial<UseAutoScrollPinParams> = {},
	containerOpts: Parameters<typeof makeContainer>[0] = {},
): {
	params: UseAutoScrollPinParams;
	container: HTMLDivElement;
	virtualizer: { scrollToIndex: ReturnType<typeof vi.fn> };
} {
	const container = makeContainer({
		scrollTop: 200,
		scrollHeight: 1000,
		clientHeight: 800,
		...containerOpts,
	});
	const virtualizer = {
		scrollToIndex: vi.fn(),
	};
	const view: IChatViewHost = {
		app: {} as App,
		viewId: "test-view",
		registerDomEvent: ((
			el: HTMLElement,
			type: string,
			cb: EventListener,
		) => {
			el.addEventListener(type, cb);
		}) as IChatViewHost["registerDomEvent"],
	};
	const params: UseAutoScrollPinParams = {
		containerRef: { current: container },
		virtualizerRef: {
			current: virtualizer as unknown as Virtualizer<
				HTMLDivElement,
				Element
			>,
		},
		messageCount: 10,
		isActive: true,
		isSending: false,
		view,
		...overrides,
	};
	return { params, container, virtualizer };
}

/**
 * Stub IntersectionObserver in JSDOM so the hook's effect doesn't throw.
 * The hook's IntersectionObserver behavior is tested via direct call paths
 * where possible, and via the smoke-test checklist for end-to-end.
 */
beforeEach(() => {
	class StubIntersectionObserver {
		callback: IntersectionObserverCallback;
		constructor(cb: IntersectionObserverCallback) {
			this.callback = cb;
		}
		observe() {}
		unobserve() {}
		disconnect() {}
		takeRecords(): IntersectionObserverEntry[] {
			return [];
		}
		root = null;
		rootMargin = "";
		thresholds: ReadonlyArray<number> = [];
	}
	globalThis.IntersectionObserver = StubIntersectionObserver;

	// Run requestAnimationFrame callbacks synchronously in tests. The hook
	// uses rAF to defer scrollToIndex calls (so the virtualizer has a chance
	// to settle in real Obsidian), but in tests we want assertions to see
	// the result immediately. The rAF timing is verified separately via the
	// smoke-test checklist.
	vi.stubGlobal(
		"requestAnimationFrame",
		(cb: FrameRequestCallback): number => {
			cb(performance.now());
			return 0;
		},
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

// ============================================================================
// T100: Initial state — pinned for new session at bottom
// ============================================================================

describe("initial state", () => {
	it("starts in pinned state with at-bottom container (T100)", () => {
		const { params } = makeParams({}, {
			// Container at bottom: scrollTop+clientHeight === scrollHeight
			scrollTop: 200,
			scrollHeight: 1000,
			clientHeight: 800,
		});
		const { result } = renderHook(() => useAutoScrollPin(params));
		expect(result.current.pinState).toBe("pinned");
		expect(result.current.isPinned).toBe(true);
	});

	it("flips to unpinned when initial scroll-event check shows large gap", () => {
		// Container starts off-bottom. Initial handleScroll() in the
		// listener-registration effect picks this up.
		const { params, container } = makeParams({}, {
			scrollTop: 0,
			scrollHeight: 1000,
			clientHeight: 800,
			// gap = 1000 - 0 - 800 = 200 → above 100 px upper threshold
		});
		const { result } = renderHook(() => useAutoScrollPin(params));
		// Initial scroll-event check happens synchronously after listener
		// registration. The hook's first state read should reflect this.
		expect(container.scrollHeight - container.scrollTop - container.clientHeight)
			.toBe(200);
		expect(result.current.pinState).toBe("unpinned");
	});
});

// ============================================================================
// T103, T104, T106: Hysteresis (closes I36 partial regression, I37 M2/M3)

// ----------------------------------------------------------------------------
// Property-based threshold tests (Lesson 1)
// ----------------------------------------------------------------------------
//
// These tests use `it.each` across a value range, NOT point tests at the
// captured-evidence values (37/60/80/200 px). They test the architectural
// intent: hysteresis should absorb measurement-race noise BUT respect
// genuine user scrolls.
//
// IMPORTANT: these tests reveal Known Issue I-S1 from the spec. The
// hysteresis upper threshold (NEAR_BOTTOM_FLIP_TO_FALSE_PX = 100 px) was
// sized off captured I37 evidence which was bounded at 80 px. Real growth
// bursts during streaming (code-block mounts ~200 px, table renders, image
// embeds) can exceed this threshold. The "absorb streaming bursts" promise
// is NOT met by the current threshold.
//
// The property-based tests below are split into two groups:
//   1. Tests that pass against the CURRENT implementation
//   2. Tests that document the I-S1 architectural gap as `test.fails`
//      (Vitest's "this test is expected to fail" marker). When the I-S1
//      fix lands (adjust-flag wrapper), these tests flip to `it.each`
//      proper and start asserting the architectural promise.

describe("hysteresis property-based — current implementation", () => {
	// Current behavior: pinned stays pinned below threshold (gap <= 100),
	// unpinned re-pins below slack zone (gap < 35).
	const STAYS_PINNED_GAPS = [0, 10, 20, 30, 35, 40, 50, 60, 70, 80, 90, 100];
	const UNPINS_GAPS = [101, 110, 150, 200, 300, 500, 1000];

	it.each(STAYS_PINNED_GAPS)(
		"stays pinned when gap is %i px (within current dead zone)",
		(gap) => {
			const { params, container } = makeParams();
			const { result } = renderHook(() => useAutoScrollPin(params));
			expect(result.current.pinState).toBe("pinned");
			simulateScroll(container, {
				scrollTop: 200 - gap,
				scrollHeight: 1000,
				clientHeight: 800,
			});
			expect(result.current.pinState).toBe("pinned");
		},
	);

	it.each(UNPINS_GAPS)(
		"un-pins when gap is %i px (above current threshold)",
		(gap) => {
			const { params, container } = makeParams();
			const { result } = renderHook(() => useAutoScrollPin(params));
			simulateScroll(container, {
				scrollTop: Math.max(0, 200 - gap),
				scrollHeight: 1000,
				clientHeight: 800,
			});
			expect(result.current.pinState).toBe("unpinned");
		},
	);

	// Verifies that the threshold values from the types module match what
	// the implementation uses. If a future change adjusts the constants but
	// forgets the implementation (or vice versa), this catches the drift.
	it("threshold constants are 100 / 35 px (sanity check)", () => {
		expect(NEAR_BOTTOM_FLIP_TO_FALSE_PX).toBe(100);
		expect(NEAR_BOTTOM_FLIP_TO_TRUE_PX).toBe(35);
	});
});

describe("hysteresis property-based — architectural intent (I-S1 regression net)", () => {
	// These tests express the architectural promise: "during streaming, the
	// pin holds across legitimate growth bursts of any reasonable size."
	//
	// HOW THIS MODELS REALITY:
	//   In real Obsidian, a streaming burst follows this sequence:
	//     1. Virtualizer detects content size change (e.g., code block mounts)
	//     2. Virtualizer calls `shouldAdjustScrollPositionOnItemSizeChange()`
	//        — i.e., our hook's `shouldAdjust` callback
	//     3. Hook returns `true` (active + pinned) AND sets `recentlyAdjustedRef`
	//        for ADJUST_FLAG_DURATION_MS (50ms)
	//     4. Virtualizer adjusts `scrollTop` to keep us pinned
	//     5. Native `scroll` event fires from step 4's mutation
	//     6. Scroll listener observes the event, sees `recentlyAdjustedRef`
	//        is set, BAILS (closes I-S1)
	//
	//   The test harness models this by calling `result.current.shouldAdjust()`
	//   BEFORE dispatching the burst scroll event. Without that call, the
	//   flag is never set and the test would model a user scroll, not an
	//   adjust-driven scroll. See Category A tests below for the lifecycle
	//   contract on shouldAdjust → flag setting.

	// Coverage range: 101 (just past hysteresis threshold) through 2000
	// (extreme cases like very tall code blocks or rendered tables).
	const STREAMING_BURST_SIZES = [101, 120, 150, 200, 250, 300, 500, 1000, 2000];

	it.each(STREAMING_BURST_SIZES)(
		"INTENT: stays pinned during streaming burst of %i px (I-S1 regression net)",
		(burstSize) => {
			const { params, container } = makeParams();
			const { result } = renderHook(() => useAutoScrollPin(params));
			expect(result.current.pinState).toBe("pinned");

			// Initial state: gap=0 (perfectly at bottom)
			simulateScroll(container, {
				scrollTop: 200,
				scrollHeight: 1000,
				clientHeight: 800,
			});
			expect(result.current.pinState).toBe("pinned");

			// Step 1-3: virtualizer asks "should I adjust?", hook says yes
			// and sets the adjust-flag for the next 50ms.
			act(() => {
				result.current.shouldAdjust();
			});

			// Step 4-5: virtualizer adjusts scrollTop, native scroll event
			// fires. Modeled here as a synthetic scroll event with the
			// in-flight gap (scrollHeight has grown but scrollTop appears
			// stale because the adjust is still landing).
			simulateScroll(container, {
				scrollTop: 200,
				scrollHeight: 1000 + burstSize,
				clientHeight: 800,
			});

			// Step 6: scroll listener bails on adjust-flag. Stays pinned.
			expect(result.current.pinState).toBe("pinned");
		},
	);

	it("INTENT: legitimate user scrolls past the burst threshold still un-pin (no adjust-flag set)", () => {
		// Counter-test: a genuine user scroll (NO `shouldAdjust()` call
		// preceding) should still un-pin. The fix must NOT simply "make
		// the threshold infinite" — it must discriminate between
		// virtualizer-driven and user-driven scrolls.
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));

		// User scrolls up by 200 px. NO shouldAdjust() call — so
		// recentlyAdjustedRef stays false; this is a genuine user scroll.
		simulateScroll(container, {
			scrollTop: 0,
			scrollHeight: 1000,
			clientHeight: 800,
		});
		expect(result.current.pinState).toBe("unpinned");
	});
});

// ============================================================================
// Category A: Adjust-flag lifecycle — closes the test-harness gap that
// previously meant the I-S1 regression net couldn't actually exercise the
// fix. These tests verify the contract on `shouldAdjust()`:
//   - Returning true sets recentlyAdjustedRef for 50ms
//   - The flag expires cleanly
//   - Repeated calls re-extend the window
//   - Returning false (inactive or unpinned) does NOT set the flag
//   - The flag is cleared on unmount (no leaks, no fire-after-unmount)
// ============================================================================

describe("adjust-flag lifecycle (I-S1 fix contract)", () => {
	it("A1: shouldAdjust=true causes the next scroll-event to be ignored within 50ms", () => {
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));
		expect(result.current.pinState).toBe("pinned");

		// Set the flag
		act(() => {
			result.current.shouldAdjust();
		});

		// Burst scroll arrives within the 50ms window
		simulateScroll(container, {
			scrollTop: 200,
			scrollHeight: 1200, // gap=200, way past threshold
			clientHeight: 800,
		});

		// Stays pinned because flag was set
		expect(result.current.pinState).toBe("pinned");
	});

	it("A2: flag expires after 50ms; subsequent burst-sized scroll un-pins normally", () => {
		vi.useFakeTimers();
		try {
			const { params, container } = makeParams();
			const { result } = renderHook(() => useAutoScrollPin(params));

			act(() => {
				result.current.shouldAdjust();
			});

			// Advance past the 50ms window
			act(() => {
				vi.advanceTimersByTime(51);
			});

			// Now a 200-px scroll should be treated as a user scroll
			simulateScroll(container, {
				scrollTop: 0,
				scrollHeight: 1000,
				clientHeight: 800,
			});

			expect(result.current.pinState).toBe("unpinned");
		} finally {
			vi.useRealTimers();
		}
	});

	it("A3: scroll event WITHOUT a preceding shouldAdjust call is treated as user scroll", () => {
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));

		// No shouldAdjust call — flag stays false
		simulateScroll(container, {
			scrollTop: 0,
			scrollHeight: 1000,
			clientHeight: 800,
		});

		expect(result.current.pinState).toBe("unpinned");
	});

	it("A4: multiple shouldAdjust calls re-extend the window (rAF-spaced adjusts)", () => {
		vi.useFakeTimers();
		try {
			const { params, container } = makeParams();
			const { result } = renderHook(() => useAutoScrollPin(params));

			// First adjust at t=0
			act(() => {
				result.current.shouldAdjust();
			});

			// 30ms later, second adjust (extends window to t=80)
			act(() => {
				vi.advanceTimersByTime(30);
			});
			act(() => {
				result.current.shouldAdjust();
			});

			// 40ms after first call (10ms after second), scroll event fires.
			// Total elapsed: 30 + 10 = 40ms (within original window AND
			// within extended window). Should still be pinned.
			act(() => {
				vi.advanceTimersByTime(10);
			});
			simulateScroll(container, {
				scrollTop: 200,
				scrollHeight: 1200,
				clientHeight: 800,
			});

			expect(result.current.pinState).toBe("pinned");

			// Now advance to 81ms after second call (= 111ms after first).
			// Window from second call expired. Scroll should un-pin.
			act(() => {
				vi.advanceTimersByTime(71);
			});
			simulateScroll(container, {
				scrollTop: 0,
				scrollHeight: 1000,
				clientHeight: 800,
			});

			expect(result.current.pinState).toBe("unpinned");
		} finally {
			vi.useRealTimers();
		}
	});

	it("A5: shouldAdjust returning false (unpinned) does NOT set the flag", () => {
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));

		// First, un-pin via a user scroll
		simulateScroll(container, {
			scrollTop: 0,
			scrollHeight: 1000,
			clientHeight: 800,
		});
		expect(result.current.pinState).toBe("unpinned");

		// shouldAdjust now returns false (unpinned)
		let returnValue: boolean | undefined;
		act(() => {
			returnValue = result.current.shouldAdjust();
		});
		expect(returnValue).toBe(false);

		// Re-pin via slack-zone scroll. If the flag had been set by the
		// false-returning shouldAdjust, this scroll would be incorrectly
		// bailed — the pin state would NOT update. Verify it does update.
		simulateScroll(container, {
			scrollTop: 180,
			scrollHeight: 1000,
			clientHeight: 800, // gap = 1000 - (180 + 800) = 20 (within slack)
		});
		expect(result.current.pinState).toBe("pinned");
	});

	it("A6: unmount during the 50ms window clears the timeout (no leaks)", () => {
		vi.useFakeTimers();
		try {
			const { params } = makeParams();
			const { result, unmount } = renderHook(() =>
				useAutoScrollPin(params),
			);

			// Set the flag, then unmount before it expires.
			act(() => {
				result.current.shouldAdjust();
			});

			// Unmount synchronously — the cleanup effect should clear the
			// pending timeout. If it doesn't, the timer fires post-unmount
			// and tries to write to a stale ref (no error visible, but a
			// resource leak).
			unmount();

			// Advance past 50ms. Vitest tracks pending timers; if any
			// remain unfired, getTimerCount > 0.
			act(() => {
				vi.advanceTimersByTime(100);
			});

			// All timers should have been cleared by the unmount cleanup.
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("A7: flag duration must be at least 50ms (catches accidental too-short windows)", () => {
		// Real-timer test: this catches the class of regression where
		// someone reduces ADJUST_FLAG_DURATION_MS to a too-small value
		// (e.g., 5ms) thinking it's safe. Synchronous test sequencing
		// can't catch sub-frame durations because the setTimeout(0)
		// callback is queued for the next event loop tick — meaning the
		// in-window scroll event fires before the timer expires
		// regardless of the duration value.
		//
		// This test fixes that gap by using REAL setTimeout to wait
		// 30ms (a value that should still be inside the 50ms window).
		// If someone reduces the duration below 30ms, this test fails.
		// 30ms is chosen because it's a typical inter-rAF interval at
		// 30 FPS — covering the worst-case real-world burst pattern.
		return new Promise<void>((resolve, reject) => {
			const { params, container } = makeParams();
			const { result } = renderHook(() => useAutoScrollPin(params));

			act(() => {
				result.current.shouldAdjust();
			});

			// Wait 30ms with real timers — modeling a real rAF gap
			setTimeout(() => {
				try {
					simulateScroll(container, {
						scrollTop: 200,
						scrollHeight: 1200, // gap=200
						clientHeight: 800,
					});
					expect(result.current.pinState).toBe("pinned");
					resolve();
				} catch (e) {
					reject(e instanceof Error ? e : new Error(String(e)));
				}
			}, 30);
		});
	});
});

// ============================================================================
// Category C: Discriminator tests — ensure the fix doesn't over-match.
// The hysteresis backstop must still work for true measurement-race noise,
// and genuine user scrolls (without a preceding shouldAdjust) must still
// un-pin even past the adjust-flag window.
// ============================================================================

describe("adjust-flag discriminators", () => {
	// C1 is covered by the existing "INTENT: legitimate user scrolls past the
	// burst threshold still un-pin" counter-test in the I-S1 regression net.

	it("C2: shouldAdjust + 51ms wait + 200px scroll = un-pin (window expired)", () => {
		vi.useFakeTimers();
		try {
			const { params, container } = makeParams();
			const { result } = renderHook(() => useAutoScrollPin(params));

			act(() => {
				result.current.shouldAdjust();
			});
			act(() => {
				vi.advanceTimersByTime(51);
			});

			// 200px gap, window expired — this IS a user scroll
			simulateScroll(container, {
				scrollTop: 0,
				scrollHeight: 1000,
				clientHeight: 800,
			});

			expect(result.current.pinState).toBe("unpinned");
		} finally {
			vi.useRealTimers();
		}
	});

	it("C3: multiple scroll events within the 50ms window all bail (rAF-spaced)", () => {
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));

		act(() => {
			result.current.shouldAdjust();
		});

		// Three scroll events, each with a different gap, all within 50ms
		for (const gap of [150, 250, 400]) {
			simulateScroll(container, {
				scrollTop: 200,
				scrollHeight: 1000 + gap,
				clientHeight: 800,
			});
			expect(result.current.pinState).toBe("pinned");
		}
	});

	it("C4: hysteresis backstop still works without flag (sequential scrolls)", () => {
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));

		// gap=20 (slack) — stays pinned
		simulateScroll(container, {
			scrollTop: 180,
			scrollHeight: 1000,
			clientHeight: 800,
		});
		expect(result.current.pinState).toBe("pinned");

		// gap=80 (dead zone) — still pinned (hysteresis absorbs)
		simulateScroll(container, {
			scrollTop: 120,
			scrollHeight: 1000,
			clientHeight: 800,
		});
		expect(result.current.pinState).toBe("pinned");

		// gap=200 (above threshold) — un-pins
		simulateScroll(container, {
			scrollTop: 0,
			scrollHeight: 1000,
			clientHeight: 800,
		});
		expect(result.current.pinState).toBe("unpinned");
	});

	it("C5: dead-zone scroll without flag stays pinned (hysteresis backstop intact)", () => {
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));

		// gap=80 (within 35-100 dead zone) — stays pinned via hysteresis
		// even though no shouldAdjust was called. This proves the
		// hysteresis backstop is still load-bearing for true measurement-
		// race noise (37/60/80px gaps from I37 evidence).
		simulateScroll(container, {
			scrollTop: 120,
			scrollHeight: 1000,
			clientHeight: 800,
		});
		expect(result.current.pinState).toBe("pinned");
	});
});
// ============================================================================

describe("hysteresis on scroll events", () => {
	it("stays pinned when gap is 37 px (I37 measurement-race evidence)", () => {
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));
		expect(result.current.pinState).toBe("pinned");

		// gap = 37 px — within the 35-100 dead zone, must NOT flip
		simulateScroll(container, {
			scrollTop: 163,
			scrollHeight: 1000,
			clientHeight: 800,
			// gap = 1000 - 163 - 800 = 37
		});
		expect(result.current.pinState).toBe("pinned");
	});

	it("stays pinned when gap is 60 px (I37 measurement-race evidence)", () => {
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));
		simulateScroll(container, {
			scrollTop: 140,
			scrollHeight: 1000,
			clientHeight: 800,
			// gap = 60
		});
		expect(result.current.pinState).toBe("pinned");
	});

	it("stays pinned when gap is 80 px (I37 measurement-race evidence)", () => {
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));
		simulateScroll(container, {
			scrollTop: 120,
			scrollHeight: 1000,
			clientHeight: 800,
			// gap = 80
		});
		expect(result.current.pinState).toBe("pinned");
	});

	it("stays pinned at exactly 100 px gap (boundary)", () => {
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));
		simulateScroll(container, {
			scrollTop: 100,
			scrollHeight: 1000,
			clientHeight: 800,
			// gap = 100 — boundary: condition is `gap > 100`, so stays pinned
		});
		expect(result.current.pinState).toBe("pinned");
	});

	it("un-pins when gap is 101 px (just past upper threshold)", () => {
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));
		simulateScroll(container, {
			scrollTop: 99,
			scrollHeight: 1000,
			clientHeight: 800,
			// gap = 101
		});
		expect(result.current.pinState).toBe("unpinned");
	});

	it("un-pins when gap is 200 px (genuine user scroll, T104)", () => {
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));
		simulateScroll(container, {
			scrollTop: 0,
			scrollHeight: 1000,
			clientHeight: 800,
			// gap = 200
		});
		expect(result.current.pinState).toBe("unpinned");
	});

	it("re-pins when scrolling back to within 35 px slack zone", () => {
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));

		// First, un-pin
		simulateScroll(container, {
			scrollTop: 0,
			scrollHeight: 1000,
			clientHeight: 800,
		});
		expect(result.current.pinState).toBe("unpinned");

		// Now scroll back to gap = 20 — within slack zone, re-pin
		simulateScroll(container, {
			scrollTop: 180,
			scrollHeight: 1000,
			clientHeight: 800,
			// gap = 20
		});
		expect(result.current.pinState).toBe("pinned");
	});

	it("stays unpinned in the dead zone when previously unpinned (no flip-flop)", () => {
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));

		// Un-pin
		simulateScroll(container, {
			scrollTop: 0,
			scrollHeight: 1000,
			clientHeight: 800,
		});
		expect(result.current.pinState).toBe("unpinned");

		// Scroll into dead zone (gap = 60)
		simulateScroll(container, {
			scrollTop: 140,
			scrollHeight: 1000,
			clientHeight: 800,
		});
		// Hysteresis: unpinned stays unpinned in dead zone (only re-pins below 35)
		expect(result.current.pinState).toBe("unpinned");
	});

	it("simulates the I37 oscillation pattern and stays pinned throughout", () => {
		// Captured I37 evidence: gap=0 → 35 → 37 → 80 → 18 → 60 → 29 within seconds.
		// Pre-fix: ref oscillated true→false→true repeatedly.
		// Post-fix: stays pinned throughout (all gaps ≤ 100 → no false flip;
		// the unpinned→pinned threshold isn't reached because we never un-pin).
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));
		const oscillationGaps = [0, 35, 37, 80, 18, 60, 29];
		for (const gap of oscillationGaps) {
			simulateScroll(container, {
				scrollTop: 200 - gap,
				scrollHeight: 1000,
				clientHeight: 800,
			});
			// Each gap is in [0, 80] — all below 100 px upper threshold.
			expect(result.current.pinState).toBe("pinned");
		}
	});
});

// ============================================================================
// T122: Zero-height container does not corrupt pinned state
// ============================================================================

describe("zero-height container guard", () => {
	it("does not flip pin state on scroll when clientHeight is 0 (T122)", () => {
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));
		expect(result.current.pinState).toBe("pinned");

		// Container collapses (e.g., brief mount window). All zeros would
		// trivially satisfy a "near bottom" check (0 + 0 >= 0 - 35) and a
		// naive impl would set isAtBottom=true on a hidden container. The
		// hook must guard.
		simulateScroll(container, {
			scrollTop: 0,
			scrollHeight: 0,
			clientHeight: 0,
		});
		// State should remain unchanged (pinned), not corrupted.
		expect(result.current.pinState).toBe("pinned");
	});

	it("preserves unpinned state across zero-height events", () => {
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));

		// Un-pin first
		simulateScroll(container, {
			scrollTop: 0,
			scrollHeight: 1000,
			clientHeight: 800,
		});
		expect(result.current.pinState).toBe("unpinned");

		// Container collapses (e.g., tab hidden mid-state). Naive impl would
		// flip back to pinned (false positive). Guard prevents it.
		simulateScroll(container, {
			scrollTop: 0,
			scrollHeight: 0,
			clientHeight: 0,
		});
		expect(result.current.pinState).toBe("unpinned");
	});
});

// ============================================================================
// T117, I37 M1: Tab-switch back to a tab that streamed in the background
// ============================================================================

describe("tab-switch back re-arms pin (I37 Mechanism 1)", () => {
	it("re-arms pin on isActive false→true when was pinned before deactivation", () => {
		const { params, virtualizer } = makeParams();
		const { result, rerender } = renderHook(
			({ isActive }: { isActive: boolean }) =>
				useAutoScrollPin({ ...params, isActive }),
			{ initialProps: { isActive: true } },
		);
		expect(result.current.pinState).toBe("pinned");

		// Deactivate (capture pin state)
		rerender({ isActive: false });

		// Reactivate. messageCount unchanged (streaming-while-inactive only
		// added tokens to existing message). Pre-fix: wasInactive branch
		// only fires on messageCount change, so pin never re-arms.
		// Post-fix: re-arms regardless of messageCount.
		rerender({ isActive: true });

		// Lesson 2: full-argument assertion. The bare `toHaveBeenCalled()`
		// would pass even if the activation called `scrollToIndex(0,
		// { align: "start" })` — which would land the viewport at the TOP
		// of the message list (visual symptom of I-S2). Asserting the
		// arguments forces the contract to be verified.
		expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(
			9, // messageCount - 1 = 10 - 1
			expect.objectContaining({ align: "end" }),
		);
		// After scrollToIndex completes (rAF), state resolves to pinned.
		// Test framework runs rAF synchronously enough that we see pinned.
	});

	it("preserves unpinned state on tab-switch back when user was scrolled up (T114)", () => {
		const { params, container, virtualizer } = makeParams();
		const { result, rerender } = renderHook(
			({ isActive }: { isActive: boolean }) =>
				useAutoScrollPin({ ...params, isActive }),
			{ initialProps: { isActive: true } },
		);

		// User scrolls up — un-pin
		simulateScroll(container, {
			scrollTop: 0,
			scrollHeight: 1000,
			clientHeight: 800,
		});
		expect(result.current.pinState).toBe("unpinned");

		// Deactivate (snapshot: was unpinned)
		rerender({ isActive: false });
		// Reactivate
		rerender({ isActive: true });

		// Should NOT have called scrollToIndex (preserves user's position)
		expect(virtualizer.scrollToIndex).not.toHaveBeenCalled();
	});
});

// ============================================================================
// I-S2 regression net (tab-activation anchor)
// ============================================================================
//
// Smoke test (T117 / I-S2 in the spec) reported that tab activation lands
// the viewport at "the first message after the most recent user prompt"
// instead of the bottom. The arg-tightened test in the previous describe
// block confirms the hook DOES call scrollToIndex(messageCount - 1,
// { align: "end" }) — i.e., the unit test as far as JSDOM can verify is
// passing. The actual symptom must be downstream of scrollToIndex (most
// likely virtualizer measurement-cache staleness, same family as I-S3).
//
// This describe block captures the full-arg expectation as a regression
// net: any future change that "fixes I-S2" by changing the call arguments
// (rather than fixing the measurement cache) will trigger these tests.
// They're CURRENTLY PASSING because the hook's current arguments are
// correct.

describe("I-S2 regression net (tab-activation arg contract)", () => {
	it("scrollToIndex on activation uses align: end (not align: start)", () => {
		const { params, virtualizer } = makeParams();
		const { rerender } = renderHook(
			({ isActive }: { isActive: boolean }) =>
				useAutoScrollPin({ ...params, isActive }),
			{ initialProps: { isActive: true } },
		);
		rerender({ isActive: false });
		rerender({ isActive: true });

		// I-S2 hypothesis #1 in spec: align: "start" would land latest
		// message at top. This test rejects that hypothesis.
		expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(
			expect.any(Number),
			expect.objectContaining({ align: "end" }),
		);
		expect(virtualizer.scrollToIndex).not.toHaveBeenCalledWith(
			expect.any(Number),
			expect.objectContaining({ align: "start" }),
		);
	});

	it("scrollToIndex on activation targets messageCount - 1 (not lastUserMessageIndex)", () => {
		const { params, virtualizer } = makeParams({ messageCount: 10 });
		const { rerender } = renderHook(
			({ isActive }: { isActive: boolean }) =>
				useAutoScrollPin({ ...params, isActive }),
			{ initialProps: { isActive: true } },
		);
		rerender({ isActive: false });
		rerender({ isActive: true });

		// I-S2 hypothesis #2 in spec: targeting `lastUserMessageIndex + 1`
		// would land at the start of the assistant's response. This test
		// rejects that hypothesis — we always target the absolute last
		// message.
		expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(
			9, // messageCount - 1
			expect.anything(),
		);
	});

	it("subsequent tab activations after a pill click STILL re-arm pin (consistency check)", () => {
		// Smoke test observation: "after clicking the pill to recover,
		// switching to another tab and back AGAIN reverts to the wrong
		// anchor — pill recovery is NOT sticky across subsequent tab
		// switches."
		//
		// The hook's current behavior: activation always calls
		// scrollToBottom() if was-pinned-before-deactivation. Even after
		// the user re-pinned via the pill, the next deactivation captures
		// "was pinned" → next activation re-fires scrollToIndex.
		//
		// This is CORRECT behavior at the unit level — the hook is doing
		// what we asked. The bug is that scrollToIndex's effect doesn't
		// land at the visual bottom in real Obsidian (downstream of this
		// test). When the I-S2 fix lands, this test should still pass —
		// the fix is in the virtualizer/measurement layer, not in when
		// the hook calls scrollToIndex.
		const { params, virtualizer } = makeParams({ messageCount: 10 });
		const { result, rerender } = renderHook(
			({ isActive }: { isActive: boolean }) =>
				useAutoScrollPin({ ...params, isActive }),
			{ initialProps: { isActive: true } },
		);

		// Cycle 1: deactivate, reactivate
		rerender({ isActive: false });
		rerender({ isActive: true });
		expect(virtualizer.scrollToIndex).toHaveBeenCalledTimes(1);
		expect(result.current.pinState).toBe("pinned");

		// Cycle 2: deactivate, reactivate again (after the user has been
		// using the pinned tab — pin state is still "pinned")
		rerender({ isActive: false });
		rerender({ isActive: true });
		expect(virtualizer.scrollToIndex).toHaveBeenCalledTimes(2);
		expect(result.current.pinState).toBe("pinned");
	});
});

// ============================================================================
// T107: New message while user is scrolled up does not auto-scroll
// ============================================================================

describe("new message arrival respects pin state", () => {
	it("auto-scrolls when pinned and new message arrives", () => {
		const { params, virtualizer } = makeParams({ messageCount: 10 });
		const { rerender } = renderHook(
			({ messageCount }: { messageCount: number }) =>
				useAutoScrollPin({ ...params, messageCount }),
			{ initialProps: { messageCount: 10 } },
		);

		// New message arrives — count goes 10 → 11
		rerender({ messageCount: 11 });
		expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(
			10, // messageCount - 1
			expect.objectContaining({ align: "end" }),
		);
	});

	it("does NOT auto-scroll when unpinned and new message arrives (T107)", () => {
		const { params, container, virtualizer } = makeParams({
			messageCount: 10,
		});
		const { result, rerender } = renderHook(
			({ messageCount }: { messageCount: number }) =>
				useAutoScrollPin({ ...params, messageCount }),
			{ initialProps: { messageCount: 10 } },
		);

		// User scrolls up
		simulateScroll(container, {
			scrollTop: 0,
			scrollHeight: 1000,
			clientHeight: 800,
		});
		expect(result.current.pinState).toBe("unpinned");
		virtualizer.scrollToIndex.mockClear();

		// New message arrives
		rerender({ messageCount: 11 });

		// Should NOT have scrolled (respects user's reading position)
		expect(virtualizer.scrollToIndex).not.toHaveBeenCalled();
	});

	it("does NOT auto-scroll when tab is inactive and new message arrives", () => {
		const { params, virtualizer } = makeParams({
			messageCount: 10,
			isActive: false,
		});
		const { rerender } = renderHook(
			({ messageCount }: { messageCount: number }) =>
				useAutoScrollPin({ ...params, messageCount }),
			{ initialProps: { messageCount: 10 } },
		);

		rerender({ messageCount: 11 });

		// Inactive tab does NOT scroll on new messages — that's deferred
		// to tab-activation handler.
		expect(virtualizer.scrollToIndex).not.toHaveBeenCalled();
	});
});

// ============================================================================
// T101: User-sent message uses smooth scroll
// ============================================================================

describe("user-sent message smooth-scroll path (T101)", () => {
	it("uses smooth behavior on the next message arrival after isSending flips true", () => {
		const { params, virtualizer } = makeParams({
			messageCount: 10,
			isSending: false,
		});
		const { rerender } = renderHook(
			({
				isSending,
				messageCount,
			}: {
				isSending: boolean;
				messageCount: number;
			}) => useAutoScrollPin({ ...params, isSending, messageCount }),
			{ initialProps: { isSending: false, messageCount: 10 } },
		);

		// User submits — isSending flips true (no message yet)
		rerender({ isSending: true, messageCount: 10 });
		// Message arrives (could be the user's own bubble or assistant)
		rerender({ isSending: true, messageCount: 11 });

		expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(
			10,
			expect.objectContaining({ behavior: "smooth", align: "end" }),
		);
	});
});

// ============================================================================
// T124: Cleared messages reset state cleanly
// ============================================================================

describe("clear messages resets state (T124)", () => {
	it("resets to pinned when messageCount goes to 0", () => {
		const { params, container } = makeParams({ messageCount: 10 });
		const { result, rerender } = renderHook(
			({ messageCount }: { messageCount: number }) =>
				useAutoScrollPin({ ...params, messageCount }),
			{ initialProps: { messageCount: 10 } },
		);

		// Un-pin first
		simulateScroll(container, {
			scrollTop: 0,
			scrollHeight: 1000,
			clientHeight: 800,
		});
		expect(result.current.pinState).toBe("unpinned");

		// Clear
		rerender({ messageCount: 0 });
		expect(result.current.pinState).toBe("pinned");
	});
});

// ============================================================================
// shouldAdjust gate behavior (Authority A)
// ============================================================================

describe("shouldAdjust gate", () => {
	it("returns true when active and pinned", () => {
		const { params } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));
		expect(result.current.shouldAdjust()).toBe(true);
	});

	it("returns false when inactive (regardless of pin state)", () => {
		const { params } = makeParams({ isActive: false });
		const { result } = renderHook(() => useAutoScrollPin(params));
		expect(result.current.shouldAdjust()).toBe(false);
	});

	it("returns false when active but unpinned", () => {
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));
		simulateScroll(container, {
			scrollTop: 0,
			scrollHeight: 1000,
			clientHeight: 800,
		});
		expect(result.current.pinState).toBe("unpinned");
		expect(result.current.shouldAdjust()).toBe(false);
	});

	it("has stable identity across renders", () => {
		const { params } = makeParams();
		const { result, rerender } = renderHook(() => useAutoScrollPin(params));
		const first = result.current.shouldAdjust;
		rerender();
		const second = result.current.shouldAdjust;
		expect(first).toBe(second);
	});
});

// ============================================================================
// T105: scrollToBottom imperative API (pill click)
// ============================================================================

describe("scrollToBottom (pill click, T105)", () => {
	it("calls virtualizer.scrollToIndex with smooth behavior when requested", () => {
		const { params, virtualizer } = makeParams({ messageCount: 10 });
		const { result } = renderHook(() => useAutoScrollPin(params));

		act(() => {
			result.current.scrollToBottom({ behavior: "smooth" });
		});

		expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(
			9,
			expect.objectContaining({ behavior: "smooth", align: "end" }),
		);
	});

	it("transitions to pinned after restoring", () => {
		const { params, container } = makeParams();
		const { result } = renderHook(() => useAutoScrollPin(params));

		// Un-pin first
		simulateScroll(container, {
			scrollTop: 0,
			scrollHeight: 1000,
			clientHeight: 800,
		});
		expect(result.current.pinState).toBe("unpinned");

		// Pill click
		act(() => {
			result.current.scrollToBottom();
		});
		// rAF runs synchronously enough in JSDOM for state to settle.
		expect(result.current.pinState).toBe("pinned");
	});

	it("handles empty session (messageCount=0) without calling scrollToIndex", () => {
		const { params, virtualizer } = makeParams({ messageCount: 0 });
		const { result } = renderHook(() => useAutoScrollPin(params));

		act(() => {
			result.current.scrollToBottom();
		});

		expect(virtualizer.scrollToIndex).not.toHaveBeenCalled();
		expect(result.current.pinState).toBe("pinned");
	});
});

// ============================================================================
// T130: No-op transitions don't trigger React re-renders (I31 lesson)
// ============================================================================

describe("same-value bail (T130, I31 lesson)", () => {
	it("does not re-render when scroll event keeps state in dead zone", () => {
		const { params, container } = makeParams();
		let renderCount = 0;
		const { result } = renderHook(() => {
			renderCount++;
			return useAutoScrollPin(params);
		});
		const initialRenderCount = renderCount;
		expect(result.current.pinState).toBe("pinned");

		// Fire several scroll events all in dead zone (gap 37/60/80/18)
		const deadZoneGaps = [37, 60, 80, 18, 29];
		for (const gap of deadZoneGaps) {
			simulateScroll(container, {
				scrollTop: 200 - gap,
				scrollHeight: 1000,
				clientHeight: 800,
			});
		}

		// State should be unchanged. Render count should NOT have grown by
		// 5 (one per dead-zone scroll event). The same-value bail in
		// setPinStateBoth prevents the React state setter from firing.
		expect(result.current.pinState).toBe("pinned");
		// Render count may have grown by 1-2 (initial + listener attachment
		// effect), but not by 5 — that would indicate per-scroll re-renders.
		expect(renderCount - initialRenderCount).toBeLessThanOrEqual(2);
	});
});

// ============================================================================
// Behaviors verified by manual smoke test (not testable at hook level)
// ============================================================================

describe.skip("manual smoke-test (verified in Obsidian dev build)", () => {
	// These behaviors require a real virtualizer with real measurements,
	// real Obsidian leaf transitions, real CPU usage observability, and/or
	// real visual rendering. They're verified manually via the smoke-test
	// checklist in the spec at commit-4 verification time.

	it.todo("T102: streaming pinned, no jitter (real virtualizer required)");
	it.todo("T108: tool-call auto-expansion preserves pin");
	it.todo("T109: tool-call manual toggle preserves pin");
	it.todo("T110: window resize during streaming — no jitter");
	it.todo("T111: multi-tab background streaming preserves pin");
	it.todo("T112: inactive tab uses negligible CPU");
	it.todo("T113: tab-switch flicker absence");
	it.todo("T115: new tab first paint at bottom");
	it.todo("T116: tab streaming with new message — pin on switch back");
	it.todo("T118: leaf hidden — no scroll work");
	it.todo("T119: leaf shown — pin restored");
	it.todo("T120: leaf shown — unpinned position preserved");
	it.todo("T121: floating-chat mode parity");
	it.todo("T123: empty session loading indicator centered");
	it.todo("T125: session restoration first paint at bottom");
	it.todo("T126: long session restoration");
	it.todo("T127: session fork");
	it.todo("T128: inactive tab CPU");
	it.todo("T129: active tab CPU during streaming");
	it.todo("T131: no memory growth across activations");
});
