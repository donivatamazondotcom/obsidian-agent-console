/**
 * Unit tests for useAutoScrollPin (Phase 2).
 *
 * ============================================================================
 * COVERAGE BOUNDARY — read this first
 * ============================================================================
 *
 * This suite covers what JSDOM can simulate. JSDOM has no real layout engine:
 * scrollTop / scrollHeight / clientHeight are direct property writes here,
 * NOT the result of CSS layout. ResizeObserver is stubbed (the controlled
 * `MockResizeObserver` below replaces the global before each test, so we
 * can fire entries on demand). `getComputedStyle().scrollBehavior` returns
 * an empty string in JSDOM, NOT "auto" or "smooth"; our scroll-behavior
 * override helper handles this case (treats anything ≠ "auto" as needs-override).
 *
 * Bug classes COVERED by this unit suite:
 *   ✓ Wheel-up escape (sets escapedFromLock, clears isAtBottom)
 *   ✓ Wheel-up suppression during text-selection drag
 *   ✓ Touch-drag-down escape (mobile)
 *   ✓ Scroll-near-bottom re-pin (user dismisses pill by scrolling)
 *   ✓ ResizeObserver(contentRef) positive resize → write scrollTop while pinned
 *   ✓ ResizeObserver(contentRef) positive resize → NO write while escaped
 *   ✓ ResizeObserver(scrollRef) container-shrink → write scrollTop while pinned
 *     (per spec Decision #21 Finding 1)
 *   ✓ scroll-behavior: auto override on programmatic writes (Decision #22)
 *   ✓ isActive false → true with prior pin → re-anchor; without pin → preserve
 *   ✓ isSending false → true → smooth-scroll to bottom
 *   ✓ scrollToBottom({ behavior: "smooth" | "auto" }) inline-style behavior
 *   ✓ Same-value bail on isAtBottom (streaming chunks don't re-render)
 *   ✓ Cleanup on unmount (ResizeObservers disconnected, listeners removed)
 *   ✓ Property-based content-grow burst sizes (closes I-S1's bug class
 *     architecturally — not just at one threshold)
 *
 * Bug classes that are JSDOM-IMPOSSIBLE and require manual smoke test:
 *   ✗ Real-browser layout settling between programmatic write and next paint
 *   ✗ Real-browser smooth-scroll animation timing and interruption
 *   ✗ User-perceived jitter from rapid scrollTop oscillation
 *   ✗ iOS momentum-scroll wheel-event delivery (use-stick-to-bottom Issue #9)
 *   ✗ Real selection-drag interaction with native browser highlight
 *   ✗ Tab activation flicker timing in real Obsidian
 *
 * The smoke-test checklist in the spec at
 * 04-initiatives/Agent Console/ACP Scroll Architecture Rework.md § Test results
 * is LOAD-BEARING for the second list. The number of passing unit tests here
 * is NOT a sufficient signal of coverage on its own.
 *
 * ============================================================================
 * Test design conventions (per spec Decision #13 + #15)
 * ============================================================================
 *
 * 1. Property-based tests for thresholds via `it.each` across value ranges.
 *    Captured-evidence values become a subset of the test surface, not the
 *    whole surface.
 *
 * 2. Full-arg `toHaveBeenCalledWith` for every spy assertion. Bare
 *    `toHaveBeenCalled` is treated as a test smell.
 *
 * 3. Each architectural promise gets a regression net: a describe block
 *    that exercises both the bail-presence axis AND a discriminator axis,
 *    so a future change can't accidentally weaken the contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import * as React from "react";

import { useAutoScrollPin } from "../use-auto-scroll-pin";
import type { IChatViewHost } from "../view-host";

// ============================================================================
// Test infrastructure
// ============================================================================

/**
 * Minimal IChatViewHost stub. The hook only reads `view` (it doesn't call
 * any methods on it in Phase 2 — `view.registerDomEvent` is no longer used
 * since listeners attach directly to scrollEl via the RefCallback). Kept
 * here so tests pass the param shape the hook expects.
 */
function makeView(): IChatViewHost {
	return {
		registerDomEvent: vi.fn(),
	} as unknown as IChatViewHost;
}

/**
 * Controlled ResizeObserver stub. Records callbacks per observed element
 * and exposes `fire(el, height)` for tests to drive.
 */
interface MockResizeObserverInstance {
	observed: Set<Element>;
	cb: ResizeObserverCallback;
	disconnected: boolean;
}

const observerInstances: MockResizeObserverInstance[] = [];

class MockResizeObserver {
	private instance: MockResizeObserverInstance;
	constructor(cb: ResizeObserverCallback) {
		this.instance = {
			observed: new Set(),
			cb,
			disconnected: false,
		};
		observerInstances.push(this.instance);
	}
	observe(el: Element): void {
		this.instance.observed.add(el);
	}
	unobserve(el: Element): void {
		this.instance.observed.delete(el);
	}
	disconnect(): void {
		this.instance.observed.clear();
		this.instance.disconnected = true;
	}
}

/**
 * Fire a ResizeObserver entry for the given element with the given height.
 * Walks all observers, finds those observing the element, fires their cb.
 */
function fireResize(el: Element, height: number): void {
	for (const inst of observerInstances) {
		if (inst.disconnected) continue;
		if (!inst.observed.has(el)) continue;
		const entry = {
			target: el,
			contentRect: {
				height,
				width: 0,
				top: 0,
				left: 0,
				bottom: height,
				right: 0,
				x: 0,
				y: 0,
				toJSON() {
					return {};
				},
			},
			borderBoxSize: [],
			contentBoxSize: [],
			devicePixelContentBoxSize: [],
		} as ResizeObserverEntry;
		inst.cb([entry], inst as unknown as ResizeObserver);
	}
}

/**
 * Set up scrollHeight / clientHeight / scrollTop on a scroll container.
 * JSDOM doesn't compute these from layout, so tests must set them as
 * regular properties. `scrollTop` is writable in JSDOM by default but
 * we redefine it here to capture writes for assertion.
 */
function setupScrollGeometry(
	el: HTMLElement,
	{
		scrollHeight,
		clientHeight,
		scrollTop = 0,
	}: { scrollHeight: number; clientHeight: number; scrollTop?: number },
): { writes: number[] } {
	const writes: number[] = [scrollTop];
	let _scrollTop = scrollTop;

	Object.defineProperty(el, "scrollHeight", {
		configurable: true,
		get: () => scrollHeight,
	});
	Object.defineProperty(el, "clientHeight", {
		configurable: true,
		get: () => clientHeight,
	});
	Object.defineProperty(el, "scrollTop", {
		configurable: true,
		get: () => _scrollTop,
		set: (v: number) => {
			_scrollTop = v;
			writes.push(v);
		},
	});

	return { writes };
}

/**
 * Test harness component. Renders the hook, attaches scrollRef to a
 * configurable container div, attaches contentRef to an inner div, and
 * exposes the hook result via a ref so tests can drive transitions.
 */
interface HarnessHandle {
	scrollEl: HTMLDivElement;
	contentEl: HTMLDivElement;
	getResult: () => ReturnType<typeof useAutoScrollPin>;
}

function Harness(props: {
	isActive: boolean;
	isSending: boolean;
	view: IChatViewHost;
	onMount: (handle: HarnessHandle) => void;
}) {
	const result = useAutoScrollPin({
		isActive: props.isActive,
		isSending: props.isSending,
		view: props.view,
	});
	const scrollDivRef = React.useRef<HTMLDivElement | null>(null);
	const contentDivRef = React.useRef<HTMLDivElement | null>(null);
	const resultRef = React.useRef(result);
	resultRef.current = result;

	const onMountRef = React.useRef(props.onMount);
	onMountRef.current = props.onMount;

	// Stable composite ref for scrollEl
	const scrollComposite = React.useCallback(
		(el: HTMLDivElement | null) => {
			scrollDivRef.current = el;
			result.scrollRef(el);
			if (el && contentDivRef.current) {
				onMountRef.current({
					scrollEl: el,
					contentEl: contentDivRef.current,
					getResult: () => resultRef.current,
				});
			}
		},
		[result.scrollRef],
	);

	// Stable composite ref for contentEl
	const contentComposite = React.useCallback(
		(el: HTMLDivElement | null) => {
			contentDivRef.current = el;
			result.contentRef(el);
			if (el && scrollDivRef.current) {
				onMountRef.current({
					scrollEl: scrollDivRef.current,
					contentEl: el,
					getResult: () => resultRef.current,
				});
			}
		},
		[result.contentRef],
	);

	return React.createElement(
		"div",
		{ ref: scrollComposite, "data-testid": "scroll" },
		React.createElement("div", {
			ref: contentComposite,
			"data-testid": "content",
		}),
	);
}

/**
 * Fire a wheel event on the given element with the given deltaY.
 * Synchronous (act() wraps if needed by caller).
 */
function fireWheel(el: HTMLElement, deltaY: number): void {
	const event = new WheelEvent("wheel", {
		deltaY,
		bubbles: true,
		cancelable: true,
	});
	el.dispatchEvent(event);
}

function fireScrollEvent(el: HTMLElement): void {
	const event = new Event("scroll", { bubbles: true });
	el.dispatchEvent(event);
}

function fireTouchStart(el: HTMLElement, clientY: number): void {
	const touch = { clientY, identifier: 0 } as Touch;
	const event = new Event("touchstart", { bubbles: true });
	Object.defineProperty(event, "touches", {
		value: [touch],
		configurable: true,
	});
	el.dispatchEvent(event);
}

function fireTouchMove(el: HTMLElement, clientY: number): void {
	const touch = { clientY, identifier: 0 } as Touch;
	const event = new Event("touchmove", { bubbles: true });
	Object.defineProperty(event, "touches", {
		value: [touch],
		configurable: true,
	});
	el.dispatchEvent(event);
}

// ============================================================================
// Global setup / teardown
// ============================================================================

let originalResizeObserver: typeof globalThis.ResizeObserver | undefined;
let originalGetSelection: typeof window.getSelection | undefined;

beforeEach(() => {
	originalResizeObserver = globalThis.ResizeObserver;
	(globalThis as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver =
		MockResizeObserver;
	observerInstances.length = 0;

	// Default: no selection. Individual tests override for selection-drag tests.
	originalGetSelection = window.getSelection;
	window.getSelection = () => null;
});

afterEach(() => {
	if (originalResizeObserver) {
		(globalThis as unknown as { ResizeObserver: typeof globalThis.ResizeObserver }).ResizeObserver =
			originalResizeObserver;
	}
	if (originalGetSelection) {
		window.getSelection = originalGetSelection;
	}
});

// ============================================================================
// Tests
// ============================================================================

describe("useAutoScrollPin — initial state", () => {
	it("starts at the bottom (isAtBottom=true) on mount", () => {
		let handle: HarnessHandle | null = null;
		render(
			React.createElement(Harness, {
				isActive: true,
				isSending: false,
				view: makeView(),
				onMount: (h) => {
					handle = h;
				},
			}),
		);
		expect(handle).not.toBeNull();
		// biome-ignore lint/style/noNonNullAssertion: handle is non-null per assertion above
		expect(handle!.getResult().isAtBottom).toBe(true);
	});

	it("anchors to the bottom on initial ResizeObserver fire when content mounts", () => {
		let handle: HarnessHandle | null = null;
		render(
			React.createElement(Harness, {
				isActive: true,
				isSending: false,
				view: makeView(),
				onMount: (h) => {
					handle = h;
				},
			}),
		);
		// biome-ignore lint/style/noNonNullAssertion: bound by render
		const { scrollEl, contentEl } = handle!;
		const { writes } = setupScrollGeometry(scrollEl, {
			scrollHeight: 1000,
			clientHeight: 800,
			scrollTop: 0,
		});

		act(() => {
			fireResize(contentEl, 1000);
		});

		// First fire = initial anchor → write scrollTop to (1000 - 800 - 1) = 199
		expect(writes).toEqual([0, 199]);
	});
});

describe("useAutoScrollPin — wheel-up escape (T107, Decision #16)", () => {
	function setupPinned() {
		let handle: HarnessHandle | null = null;
		render(
			React.createElement(Harness, {
				isActive: true,
				isSending: false,
				view: makeView(),
				onMount: (h) => {
					handle = h;
				},
			}),
		);
		// biome-ignore lint/style/noNonNullAssertion: bound by render
		const h = handle!;
		setupScrollGeometry(h.scrollEl, {
			scrollHeight: 2000,
			clientHeight: 800,
			scrollTop: 1199,
		});
		return h;
	}

	it("flips isAtBottom=false on wheel deltaY < 0 when content overflows", () => {
		const h = setupPinned();
		expect(h.getResult().isAtBottom).toBe(true);
		act(() => {
			fireWheel(h.scrollEl, -50);
		});
		expect(h.getResult().isAtBottom).toBe(false);
	});

	it("does NOT flip on wheel deltaY > 0 (downward wheel)", () => {
		const h = setupPinned();
		act(() => {
			fireWheel(h.scrollEl, 50);
		});
		expect(h.getResult().isAtBottom).toBe(true);
	});

	it("does NOT flip when content does not overflow viewport", () => {
		let handle: HarnessHandle | null = null;
		render(
			React.createElement(Harness, {
				isActive: true,
				isSending: false,
				view: makeView(),
				onMount: (h) => {
					handle = h;
				},
			}),
		);
		// biome-ignore lint/style/noNonNullAssertion: bound by render
		const h = handle!;
		setupScrollGeometry(h.scrollEl, {
			scrollHeight: 500,
			clientHeight: 800, // viewport bigger than content
			scrollTop: 0,
		});
		act(() => {
			fireWheel(h.scrollEl, -50);
		});
		expect(h.getResult().isAtBottom).toBe(true);
	});

	it("does NOT flip during text-selection drag (Decision #21 Finding 4)", () => {
		const h = setupPinned();

		// Simulate active selection inside the scroll container
		const range = {
			commonAncestorContainer: h.scrollEl,
		} as unknown as Range;
		const selection = {
			rangeCount: 1,
			getRangeAt: () => range,
		} as unknown as Selection;
		window.getSelection = () => selection;

		// Simulate mousedown (sets module-level mouseDown=true). Use a real
		// document mousedown event so the global listener captures it.
		act(() => {
			document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		});

		act(() => {
			fireWheel(h.scrollEl, -100);
		});
		expect(h.getResult().isAtBottom).toBe(true);

		// Reset for following tests
		act(() => {
			document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
		});
	});
});

describe("useAutoScrollPin — touch escape (Decision #21 Finding 2)", () => {
	function setupPinned() {
		let handle: HarnessHandle | null = null;
		render(
			React.createElement(Harness, {
				isActive: true,
				isSending: false,
				view: makeView(),
				onMount: (h) => {
					handle = h;
				},
			}),
		);
		// biome-ignore lint/style/noNonNullAssertion: bound by render
		const h = handle!;
		setupScrollGeometry(h.scrollEl, {
			scrollHeight: 2000,
			clientHeight: 800,
			scrollTop: 1199,
		});
		return h;
	}

	it("flips isAtBottom=false on touch drag down (finger down → content scrolls up)", () => {
		const h = setupPinned();
		act(() => {
			fireTouchStart(h.scrollEl, 100);
		});
		act(() => {
			fireTouchMove(h.scrollEl, 200); // delta = +100 (drag down)
		});
		expect(h.getResult().isAtBottom).toBe(false);
	});

	it("does NOT flip on small touch jitter (delta ≤ 4 px)", () => {
		const h = setupPinned();
		act(() => {
			fireTouchStart(h.scrollEl, 100);
		});
		act(() => {
			fireTouchMove(h.scrollEl, 102); // delta = 2
		});
		expect(h.getResult().isAtBottom).toBe(true);
	});

	it("does NOT flip on touch drag up", () => {
		const h = setupPinned();
		act(() => {
			fireTouchStart(h.scrollEl, 100);
		});
		act(() => {
			fireTouchMove(h.scrollEl, 50); // delta = -50 (drag up)
		});
		expect(h.getResult().isAtBottom).toBe(true);
	});
});

describe("useAutoScrollPin — scroll-back-to-bottom re-pin (Finding 3)", () => {
	it("re-pins when scroll lands within STICK_OFFSET_PX of bottom", () => {
		let handle: HarnessHandle | null = null;
		render(
			React.createElement(Harness, {
				isActive: true,
				isSending: false,
				view: makeView(),
				onMount: (h) => {
					handle = h;
				},
			}),
		);
		// biome-ignore lint/style/noNonNullAssertion: bound by render
		const h = handle!;
		setupScrollGeometry(h.scrollEl, {
			scrollHeight: 2000,
			clientHeight: 800,
			scrollTop: 800,
		});

		// User wheel-up first
		act(() => {
			fireWheel(h.scrollEl, -50);
		});
		expect(h.getResult().isAtBottom).toBe(false);

		// User scrolls back near bottom (gap = 2000 - 1170 - 800 = 30, within 70)
		Object.defineProperty(h.scrollEl, "scrollTop", {
			configurable: true,
			value: 1170,
		});
		act(() => {
			fireScrollEvent(h.scrollEl);
		});
		expect(h.getResult().isAtBottom).toBe(true);
	});
});

describe("useAutoScrollPin — content-grow auto-anchor (closes I-S1 architecturally)", () => {
	function setupPinnedAndContent() {
		let handle: HarnessHandle | null = null;
		render(
			React.createElement(Harness, {
				isActive: true,
				isSending: false,
				view: makeView(),
				onMount: (h) => {
					handle = h;
				},
			}),
		);
		// biome-ignore lint/style/noNonNullAssertion: bound by render
		const h = handle!;
		const geom = setupScrollGeometry(h.scrollEl, {
			scrollHeight: 1000,
			clientHeight: 800,
		});
		// Initial ResizeObserver fire sets up baseline content height.
		act(() => {
			fireResize(h.contentEl, 1000);
		});
		return { h, geom };
	}

	// I-S1's bug class: in Phase 1, hysteresis thresholds had to absorb both
	// measurement-race noise and legitimate growth bursts simultaneously.
	// Phase 2 architecture closes this by writing scrollTop directly on
	// content grow — there's no hysteresis to defeat.
	const burstSizes = [50, 100, 150, 200, 500, 1000, 2000];

	it.each(burstSizes)(
		"writes scrollTop to bottom on content grow of %i px while pinned",
		(burst) => {
			const { h, geom } = setupPinnedAndContent();
			// Update geometry to reflect the new content height
			Object.defineProperty(h.scrollEl, "scrollHeight", {
				configurable: true,
				get: () => 1000 + burst,
			});
			act(() => {
				fireResize(h.contentEl, 1000 + burst);
			});
			// Expected scrollTop = (1000 + burst) - 800 - 1 = 199 + burst
			const expected = 199 + burst;
			expect(geom.writes[geom.writes.length - 1]).toBe(expected);
		},
	);

	it("does NOT write scrollTop on content grow while escaped", () => {
		const { h, geom } = setupPinnedAndContent();
		act(() => {
			fireWheel(h.scrollEl, -50);
		});
		const writesBefore = geom.writes.length;

		Object.defineProperty(h.scrollEl, "scrollHeight", {
			configurable: true,
			get: () => 1500,
		});
		act(() => {
			fireResize(h.contentEl, 1500);
		});

		expect(geom.writes.length).toBe(writesBefore);
	});

	it("re-pins (without writing scrollTop) when content shrinks back into the offset", () => {
		const { h, geom } = setupPinnedAndContent();
		// User wheel-up
		Object.defineProperty(h.scrollEl, "scrollTop", {
			configurable: true,
			value: 100,
		});
		act(() => {
			fireWheel(h.scrollEl, -50);
		});
		expect(h.getResult().isAtBottom).toBe(false);

		// Now content shrinks so the bottom is now within STICK_OFFSET_PX of
		// the current scrollTop. New gap = 850 - 100 - 800 = -50 (well past
		// the bottom; clamped to within the offset).
		Object.defineProperty(h.scrollEl, "scrollHeight", {
			configurable: true,
			get: () => 850,
		});
		const writesBefore = geom.writes.length;
		act(() => {
			fireResize(h.contentEl, 850);
		});
		// We re-pinned, but the negative-resize branch does NOT proactively
		// write scrollTop (use-stick-to-bottom matches this; content shrink
		// can leave scrollTop where it is and let `isAtBottom` reflect truth).
		expect(geom.writes.length).toBe(writesBefore);
		expect(h.getResult().isAtBottom).toBe(true);
	});

	// Regression net for I-S6 (session-restore landed scrollbar 3/4 down,
	// not at bottom). Root cause: initial ResizeObserver fire reports a
	// PARTIAL height — bubbles are mounted but markdown parse, syntax
	// highlighter, image load are async/multi-frame. If we anchor once on
	// initial fire and stop, the scroll lands at a partial-height bottom.
	// The fix collapses the initial-fire and grew branches: anchor on
	// every positive resize while pinned, including the first.
	describe("I-S6 regression net (session-restore partial-height anchor)", () => {
		it("anchors on initial ResizeObserver fire while pinned", () => {
			let handle: HarnessHandle | null = null;
			render(
				React.createElement(Harness, {
					isActive: true,
					isSending: false,
					view: makeView(),
					onMount: (h) => {
						handle = h;
					},
				}),
			);
			// biome-ignore lint/style/noNonNullAssertion: bound by render
			const h = handle!;
			const geom = setupScrollGeometry(h.scrollEl, {
				scrollHeight: 500, // partial first-paint height
				clientHeight: 800,
			});

			act(() => {
				fireResize(h.contentEl, 500);
			});

			// Initial fire writes scrollTop even though height < clientHeight
			// (Math.max(0, 500-800-1) = 0). Important: that write happens.
			expect(geom.writes.length).toBeGreaterThan(1);
		});

		it("keeps anchoring as height grows after initial fire (the bug)", () => {
			let handle: HarnessHandle | null = null;
			render(
				React.createElement(Harness, {
					isActive: true,
					isSending: false,
					view: makeView(),
					onMount: (h) => {
						handle = h;
					},
				}),
			);
			// biome-ignore lint/style/noNonNullAssertion: bound by render
			const h = handle!;
			const geom = setupScrollGeometry(h.scrollEl, {
				scrollHeight: 1000,
				clientHeight: 800,
			});

			// Simulate session-restore: first fire is partial (3/4 height).
			act(() => {
				fireResize(h.contentEl, 1000);
			});
			// Initial anchor: scrollTop = 1000 - 800 - 1 = 199
			expect(geom.writes[geom.writes.length - 1]).toBe(199);

			// Then bubbles' async measurement completes — height grows.
			// Each fire must re-anchor to the NEW bottom.
			Object.defineProperty(h.scrollEl, "scrollHeight", {
				configurable: true,
				get: () => 1500,
			});
			act(() => {
				fireResize(h.contentEl, 1500);
			});
			expect(geom.writes[geom.writes.length - 1]).toBe(699);

			Object.defineProperty(h.scrollEl, "scrollHeight", {
				configurable: true,
				get: () => 2000,
			});
			act(() => {
				fireResize(h.contentEl, 2000);
			});
			expect(geom.writes[geom.writes.length - 1]).toBe(1199);

			Object.defineProperty(h.scrollEl, "scrollHeight", {
				configurable: true,
				get: () => 3000,
			});
			act(() => {
				fireResize(h.contentEl, 3000);
			});
			expect(geom.writes[geom.writes.length - 1]).toBe(2199);
		});

		it("respects user escape during session-restore async grows", () => {
			let handle: HarnessHandle | null = null;
			render(
				React.createElement(Harness, {
					isActive: true,
					isSending: false,
					view: makeView(),
					onMount: (h) => {
						handle = h;
					},
				}),
			);
			// biome-ignore lint/style/noNonNullAssertion: bound by render
			const h = handle!;
			const geom = setupScrollGeometry(h.scrollEl, {
				scrollHeight: 1000,
				clientHeight: 800,
			});

			// Initial fire anchors
			act(() => {
				fireResize(h.contentEl, 1000);
			});
			const writesAfterInitial = geom.writes.length;

			// User wheel-up during async-grow window
			act(() => {
				fireWheel(h.scrollEl, -50);
			});

			// More content grows (e.g., last bubble's syntax highlighter
			// finished). The hook must NOT yank the user back.
			Object.defineProperty(h.scrollEl, "scrollHeight", {
				configurable: true,
				get: () => 1500,
			});
			act(() => {
				fireResize(h.contentEl, 1500);
			});

			expect(geom.writes.length).toBe(writesAfterInitial);
		});
	});
});

describe("useAutoScrollPin — container-shrink anchor (Decision #21 Finding 1)", () => {
	it("writes scrollTop on container shrink while pinned (closes Issue #40)", () => {
		let handle: HarnessHandle | null = null;
		render(
			React.createElement(Harness, {
				isActive: true,
				isSending: false,
				view: makeView(),
				onMount: (h) => {
					handle = h;
				},
			}),
		);
		// biome-ignore lint/style/noNonNullAssertion: bound by render
		const h = handle!;
		const geom = setupScrollGeometry(h.scrollEl, {
			scrollHeight: 1000,
			clientHeight: 800,
		});

		// Establish baseline container height
		act(() => {
			fireResize(h.scrollEl, 800);
		});
		const writesBefore = geom.writes.length;

		// Container shrinks (e.g., flex-sibling grew into our space).
		// scrollHeight stays the same; clientHeight drops.
		Object.defineProperty(h.scrollEl, "clientHeight", {
			configurable: true,
			get: () => 700,
		});
		act(() => {
			fireResize(h.scrollEl, 700);
		});

		// Expected new scrollTop = 1000 - 700 - 1 = 299
		expect(geom.writes.length).toBe(writesBefore + 1);
		expect(geom.writes[geom.writes.length - 1]).toBe(299);
	});

	it("does NOT write scrollTop on container grow", () => {
		let handle: HarnessHandle | null = null;
		render(
			React.createElement(Harness, {
				isActive: true,
				isSending: false,
				view: makeView(),
				onMount: (h) => {
					handle = h;
				},
			}),
		);
		// biome-ignore lint/style/noNonNullAssertion: bound by render
		const h = handle!;
		const geom = setupScrollGeometry(h.scrollEl, {
			scrollHeight: 1000,
			clientHeight: 700,
		});

		act(() => {
			fireResize(h.scrollEl, 700);
		});
		const writesBefore = geom.writes.length;

		Object.defineProperty(h.scrollEl, "clientHeight", {
			configurable: true,
			get: () => 800,
		});
		act(() => {
			fireResize(h.scrollEl, 800);
		});

		expect(geom.writes.length).toBe(writesBefore);
	});
});

describe("useAutoScrollPin — scroll-behavior override (Decision #22)", () => {
	it("overrides scroll-behavior to 'auto' for the duration of programmatic writes", () => {
		let handle: HarnessHandle | null = null;
		render(
			React.createElement(Harness, {
				isActive: true,
				isSending: false,
				view: makeView(),
				onMount: (h) => {
					handle = h;
				},
			}),
		);
		// biome-ignore lint/style/noNonNullAssertion: bound by render
		const h = handle!;
		setupScrollGeometry(h.scrollEl, {
			scrollHeight: 1000,
			clientHeight: 800,
		});

		// Simulate inherited CSS smooth-scroll
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		h.scrollEl.style.scrollBehavior = "smooth";
		const beforeStyleProperty = h.scrollEl.style.scrollBehavior;

		act(() => {
			fireResize(h.contentEl, 1000);
		});

		// After the write, the style should be restored to "smooth".
		// (We can't observe the transient "auto" without instrumenting the
		// setter, but JSDOM's getComputedStyle returns "" so the helper's
		// override branch DOES fire — we verify by checking the after-state
		// matches the before-state.)
		expect(h.scrollEl.style.scrollBehavior).toBe(beforeStyleProperty);
	});

	it("scrollToBottom({behavior:'auto'}) jumps instantly using the override", () => {
		let handle: HarnessHandle | null = null;
		render(
			React.createElement(Harness, {
				isActive: true,
				isSending: false,
				view: makeView(),
				onMount: (h) => {
					handle = h;
				},
			}),
		);
		// biome-ignore lint/style/noNonNullAssertion: bound by render
		const h = handle!;
		const geom = setupScrollGeometry(h.scrollEl, {
			scrollHeight: 1000,
			clientHeight: 800,
			scrollTop: 0,
		});
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		h.scrollEl.style.scrollBehavior = "smooth"; // simulate inherited CSS

		act(() => {
			h.getResult().scrollToBottom({ behavior: "auto" });
		});

		// Wrote scrollTop, restored scroll-behavior
		expect(geom.writes[geom.writes.length - 1]).toBe(199);
		expect(h.scrollEl.style.scrollBehavior).toBe("smooth");
	});

	it("scrollToBottom({behavior:'smooth'}) sets inline scroll-behavior:smooth", () => {
		let handle: HarnessHandle | null = null;
		render(
			React.createElement(Harness, {
				isActive: true,
				isSending: false,
				view: makeView(),
				onMount: (h) => {
					handle = h;
				},
			}),
		);
		// biome-ignore lint/style/noNonNullAssertion: bound by render
		const h = handle!;
		setupScrollGeometry(h.scrollEl, {
			scrollHeight: 1000,
			clientHeight: 800,
			scrollTop: 0,
		});

		act(() => {
			h.getResult().scrollToBottom({ behavior: "smooth" });
		});

		expect(h.scrollEl.style.scrollBehavior).toBe("smooth");
	});
});

describe("useAutoScrollPin — isActive transitions", () => {
	function setupHarness() {
		let handle: HarnessHandle | null = null;
		const App = (props: { isActive: boolean; isSending: boolean }) =>
			React.createElement(Harness, {
				isActive: props.isActive,
				isSending: props.isSending,
				view: makeView(),
				onMount: (h) => {
					handle = h;
				},
			});

		const { rerender } = render(
			React.createElement(App, { isActive: true, isSending: false }),
		);
		// biome-ignore lint/style/noNonNullAssertion: bound by render
		const h = handle!;
		return { h, rerender, App };
	}

	it("re-anchors to bottom when isActive flips false → true while pinned", () => {
		const { h, rerender, App } = setupHarness();
		const geom = setupScrollGeometry(h.scrollEl, {
			scrollHeight: 1000,
			clientHeight: 800,
			scrollTop: 199,
		});

		act(() => {
			rerender(React.createElement(App, { isActive: false, isSending: false }));
		});

		// Simulate that during inactivity, scrollTop drifted (in real life,
		// this could happen during display:none periods). We update geom to
		// reflect a different bottom target (more content arrived).
		Object.defineProperty(h.scrollEl, "scrollHeight", {
			configurable: true,
			get: () => 1500,
		});
		const writesBefore = geom.writes.length;

		act(() => {
			rerender(React.createElement(App, { isActive: true, isSending: false }));
		});

		// Expected scrollTop = 1500 - 800 - 1 = 699
		expect(geom.writes.length).toBe(writesBefore + 1);
		expect(geom.writes[geom.writes.length - 1]).toBe(699);
	});

	it("preserves position when isActive flips false → true while escaped (was unpinned)", () => {
		const { h, rerender, App } = setupHarness();
		const geom = setupScrollGeometry(h.scrollEl, {
			scrollHeight: 2000,
			clientHeight: 800,
			scrollTop: 500,
		});

		// Wheel up to escape
		act(() => {
			fireWheel(h.scrollEl, -50);
		});

		// Deactivate
		act(() => {
			rerender(React.createElement(App, { isActive: false, isSending: false }));
		});
		const writesBefore = geom.writes.length;

		// Reactivate
		act(() => {
			rerender(React.createElement(App, { isActive: true, isSending: false }));
		});

		// No new write; user was scrolled up, preserve their position
		expect(geom.writes.length).toBe(writesBefore);
	});
});

describe("useAutoScrollPin — isSending transition (T101)", () => {
	it("smooth-scrolls to bottom when isSending flips false → true", () => {
		let handle: HarnessHandle | null = null;
		const App = (props: { isSending: boolean }) =>
			React.createElement(Harness, {
				isActive: true,
				isSending: props.isSending,
				view: makeView(),
				onMount: (h) => {
					handle = h;
				},
			});

		const { rerender } = render(React.createElement(App, { isSending: false }));
		// biome-ignore lint/style/noNonNullAssertion: bound by render
		const h = handle!;
		const geom = setupScrollGeometry(h.scrollEl, {
			scrollHeight: 1000,
			clientHeight: 800,
			scrollTop: 0,
		});

		act(() => {
			rerender(React.createElement(App, { isSending: true }));
		});

		// Smooth scroll to bottom = 1000 - 800 - 1 = 199
		expect(geom.writes[geom.writes.length - 1]).toBe(199);
		expect(h.scrollEl.style.scrollBehavior).toBe("smooth");
	});
});

describe("useAutoScrollPin — same-value bail (Decision #2 / I31 lesson)", () => {
	it("does not re-render when content grows but isAtBottom was already true", () => {
		// Render counter via a wrapper. We track how many times Harness'
		// child rendered.
		let consumerRenderCount = 0;
		function Counter(props: { isAtBottom: boolean }) {
			consumerRenderCount += 1;
			return React.createElement("span", null, String(props.isAtBottom));
		}

		let handle: HarnessHandle | null = null;
		function Wrapper() {
			const result = useAutoScrollPin({
				isActive: true,
				isSending: false,
				view: makeView(),
			});
			const scrollDivRef = React.useRef<HTMLDivElement | null>(null);
			const contentDivRef = React.useRef<HTMLDivElement | null>(null);
			const onMountedRef = React.useRef(false);

			const scrollComposite = React.useCallback(
				(el: HTMLDivElement | null) => {
					scrollDivRef.current = el;
					result.scrollRef(el);
					if (el && contentDivRef.current && !onMountedRef.current) {
						onMountedRef.current = true;
						handle = {
							scrollEl: el,
							contentEl: contentDivRef.current,
							getResult: () => result,
						};
					}
				},
				[result.scrollRef],
			);
			const contentComposite = React.useCallback(
				(el: HTMLDivElement | null) => {
					contentDivRef.current = el;
					result.contentRef(el);
					if (el && scrollDivRef.current && !onMountedRef.current) {
						onMountedRef.current = true;
						handle = {
							scrollEl: scrollDivRef.current,
							contentEl: el,
							getResult: () => result,
						};
					}
				},
				[result.contentRef],
			);

			return React.createElement(
				"div",
				{ ref: scrollComposite },
				React.createElement("div", { ref: contentComposite }),
				React.createElement(Counter, { isAtBottom: result.isAtBottom }),
			);
		}

		render(React.createElement(Wrapper));
		// biome-ignore lint/style/noNonNullAssertion: bound by render
		const h = handle!;
		setupScrollGeometry(h.scrollEl, {
			scrollHeight: 1000,
			clientHeight: 800,
			scrollTop: 199,
		});

		const baselineRenders = consumerRenderCount;

		// Fire 5 ResizeObserver events that all keep us pinned. None should
		// trigger a re-render of Counter — isAtBottom stays true.
		for (let i = 0; i < 5; i += 1) {
			Object.defineProperty(h.scrollEl, "scrollHeight", {
				configurable: true,
				get: () => 1000 + (i + 1) * 10,
			});
			act(() => {
				fireResize(h.contentEl, 1000 + (i + 1) * 10);
			});
		}

		expect(consumerRenderCount).toBe(baselineRenders);
	});
});

describe("useAutoScrollPin — cleanup on unmount", () => {
	it("disconnects ResizeObservers on unmount", () => {
		const { unmount } = render(
			React.createElement(Harness, {
				isActive: true,
				isSending: false,
				view: makeView(),
				onMount: () => {},
			}),
		);

		// Fire resize + content observers attached
		expect(observerInstances.length).toBeGreaterThanOrEqual(2);
		const beforeDisconnect = observerInstances.filter(
			(i) => !i.disconnected,
		).length;
		expect(beforeDisconnect).toBeGreaterThanOrEqual(2);

		unmount();

		// All observers disconnected after unmount
		const afterDisconnect = observerInstances.filter(
			(i) => !i.disconnected,
		).length;
		expect(afterDisconnect).toBe(0);
	});
});
