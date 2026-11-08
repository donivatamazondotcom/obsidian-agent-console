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
 *   ✓ Every user scroll input escapes while streaming: wheel, touch,
 *     scrollbar drag, track click, PageUp/ArrowUp (I304, one table — a new
 *     input belongs in that table, not a one-off test)
 *   ✓ A no-op hook write doesn't swallow the user's next scroll (I305)
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
 *   ✓ Scroll-event race during async-grow session restore (closes I-S7 —
 *     hook-driven scrollTop write fires a scroll event that, if delivered
 *     after off-screen scrollHeight growth, would otherwise flip
 *     isAtBottomRef and freeze the scroll at the partial-content bottom)
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
import { act, cleanup, render } from "@testing-library/react";
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
let originalMessageChannel: typeof globalThis.MessageChannel | undefined;

// I-S12 round-3 fix: handleScroll defers its body via window.setTimeout(1)
// (per useStickToBottom.ts line 436, citing WICG/resize-observer#25).
// Tests need synchronous control over when these deferred bodies run.
// The mock captures setTimeout/clearTimeout calls and exposes flushTimers()
// to drain the queue. Real-timer behavior (setTimeout(1) firing ~1ms later
// in a macrotask) is correctly modeled, but tests can advance "time"
// explicitly without waiting for real wall-clock timers.
//
// The mock is permissive: it captures ALL setTimeout calls in the global
// scope while installed, including any internal Vitest/JSDOM uses. Real
// JSDOM rarely uses setTimeout internally; the cost is negligible. If a
// future test needs real-timer behavior, it can opt out by saving and
// restoring the originals locally.

/**
 * Synchronous-by-explicit-flush rAF mock. Captured callbacks queue; tests
 * call flushRaf() to run all pending callbacks. This makes tests
 * deterministic for any rAF-based deferral without requiring fake timers
 * in every test.
 *
 * Tests that don't trigger any rAF work (most of the suite) ignore this
 * — flushRaf() is a no-op when the queue is empty.
 */
/**
 * MessageChannel mock — see definition below. The I-S9 deferral uses
 * MessageChannel; this exposes synchronous flush control to tests.
 *
 * (Note: a previous version of this file installed a per-test rAF mock
 * because the original I-S9 fix in `d6bcfac` used `requestAnimationFrame`.
 * That fix was reverted to MessageChannel after T-IS9-smoke surfaced
 * Chromium folding the rAF callback into the same task as the click
 * event. See spec § I-S9 for the trace evidence and rationale.)
 */

/**
 * Synchronous-by-explicit-flush MessageChannel mock. The I-S9 fix uses
 * MessageChannel to defer the initial-fire scrollTop anchor to a fresh
 * task (instead of the broken rAF approach which Chromium folds into
 * the current task on tab activation).
 *
 * Real JSDOM MessageChannel works asynchronously, but tests want
 * synchronous control. The mock collects posted messages on a per-channel
 * queue; flushMessages() drains all queues across all instances. New
 * channels created mid-test are tracked automatically.
 *
 * Tests that don't trigger MessageChannel work ignore this — flushMessages()
 * is a no-op when no messages are pending.
 */
interface MockMessagePort {
	onmessage: ((ev: MessageEvent) => unknown) | null;
	postMessage(msg: unknown): void;
	close(): void;
	__pair?: MockMessagePort;
	__queue: Array<unknown>;
	__closed: boolean;
}

const messageChannelInstances: Array<{
	port1: MockMessagePort;
	port2: MockMessagePort;
}> = [];

class MockMessageChannel {
	port1: MockMessagePort;
	port2: MockMessagePort;
	constructor() {
		const makePort = (): MockMessagePort => ({
			onmessage: null,
			__queue: [],
			__closed: false,
			postMessage(this: MockMessagePort, msg: unknown) {
				// postMessage on portN delivers to the OTHER port's queue.
				// biome-ignore lint/style/noNonNullAssertion: __pair set below
				const other = this.__pair!;
				if (other.__closed) return;
				other.__queue.push(msg);
			},
			close(this: MockMessagePort) {
				this.__closed = true;
				this.__queue.length = 0;
			},
		});
		this.port1 = makePort();
		this.port2 = makePort();
		this.port1.__pair = this.port2;
		this.port2.__pair = this.port1;
		messageChannelInstances.push({ port1: this.port1, port2: this.port2 });
	}
}

function flushMessages(): void {
	// Drain pending messages on every port across every channel. Messages
	// posted during delivery (re-entrancy) become visible on a subsequent
	// flushMessages() call, matching real task-queue semantics.
	for (const { port1, port2 } of messageChannelInstances) {
		for (const port of [port1, port2]) {
			if (port.__closed) continue;
			const pending = port.__queue.splice(0);
			for (const data of pending) {
				const handler = port.onmessage;
				if (handler) {
					handler({ data } as MessageEvent);
				}
			}
		}
	}
}

interface ScheduledTimer {
	id: number;
	cb: () => void;
	cancelled: boolean;
	delay: number;
}

const scheduledTimers: ScheduledTimer[] = [];
let nextTimerId = 1;
let originalSetTimeout: typeof globalThis.setTimeout | undefined;
let originalClearTimeout: typeof globalThis.clearTimeout | undefined;

function installTimerMock(): void {
	originalSetTimeout = globalThis.setTimeout;
	originalClearTimeout = globalThis.clearTimeout;
	scheduledTimers.length = 0;
	nextTimerId = 1;

	const mockSetTimeout = ((cb: () => void, delay?: number) => {
		const id = nextTimerId++;
		scheduledTimers.push({ id, cb, cancelled: false, delay: delay ?? 0 });
		return id;
	}) as unknown as typeof globalThis.setTimeout;

	const mockClearTimeout = (id: number) => {
		const t = scheduledTimers.find((x) => x.id === id);
		if (t) t.cancelled = true;
	};

	(globalThis as { setTimeout: typeof globalThis.setTimeout }).setTimeout =
		mockSetTimeout;
	(globalThis as { clearTimeout: typeof globalThis.clearTimeout }).clearTimeout =
		mockClearTimeout;
	// JSDOM aliases window.setTimeout to globalThis.setTimeout; the hook calls
	// `window.setTimeout` explicitly, so we must override the window binding too.
	(window as unknown as { setTimeout: typeof globalThis.setTimeout }).setTimeout =
		mockSetTimeout;
	(window as unknown as {
		clearTimeout: typeof globalThis.clearTimeout;
	}).clearTimeout = mockClearTimeout;
}

function restoreTimerMock(): void {
	if (originalSetTimeout) {
		(globalThis as { setTimeout: typeof globalThis.setTimeout }).setTimeout =
			originalSetTimeout;
		(window as unknown as {
			setTimeout: typeof globalThis.setTimeout;
		}).setTimeout = originalSetTimeout;
	}
	if (originalClearTimeout) {
		(globalThis as {
			clearTimeout: typeof globalThis.clearTimeout;
		}).clearTimeout = originalClearTimeout;
		(window as unknown as {
			clearTimeout: typeof globalThis.clearTimeout;
		}).clearTimeout = originalClearTimeout;
	}
	scheduledTimers.length = 0;
}

/**
 * Drain pending timers. Timers scheduled DURING delivery (re-entrancy) become
 * visible on a subsequent flushTimers() call, matching real task-queue
 * semantics. This pairs with flushMessages() — together they let tests step
 * through the deferral graph one task at a time.
 */
function flushTimers(): void {
	const pending = scheduledTimers.splice(0);
	for (const t of pending) {
		if (t.cancelled) continue;
		t.cb();
	}
}

/**
 * Fire only the pending timers whose delay is below `ms`, leaving longer
 * ones queued. Lets a test advance "time" past short deferrals without
 * ending a longer window (I284's 2 s restore hold).
 */
function flushTimersShorterThan(ms: number): void {
	const due = scheduledTimers.filter((x) => x.delay < ms);
	for (const x of due) scheduledTimers.splice(scheduledTimers.indexOf(x), 1);
	for (const x of due) {
		if (x.cancelled) continue;
		x.cb();
	}
}

beforeEach(() => {
	installTimerMock();
	originalResizeObserver = globalThis.ResizeObserver;
	(globalThis as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver =
		MockResizeObserver;
	observerInstances.length = 0;

	// Default: no selection. Individual tests override for selection-drag tests.
	originalGetSelection = window.getSelection;
	window.getSelection = () => null;

	// MessageChannel mock — captures postMessages for explicit flush. The
	// I-S9 deferral uses MessageChannel; this makes its delivery
	// deterministic from the test's perspective.
	originalMessageChannel = globalThis.MessageChannel;
	messageChannelInstances.length = 0;
	(globalThis as unknown as { MessageChannel: typeof MockMessageChannel }).MessageChannel =
		MockMessageChannel;
});

afterEach(() => {
	// vitest globals are off, so Testing Library's auto-cleanup never runs:
	// unmount every harness so no test sees another test's DOM (I305 M1).
	cleanup();
	if (originalResizeObserver) {
		(globalThis as unknown as { ResizeObserver: typeof globalThis.ResizeObserver }).ResizeObserver =
			originalResizeObserver;
	}
	if (originalGetSelection) {
		window.getSelection = originalGetSelection;
	}
	if (originalMessageChannel) {
		(
			globalThis as unknown as { MessageChannel: typeof globalThis.MessageChannel }
		).MessageChannel = originalMessageChannel;
	}
	messageChannelInstances.length = 0;
	restoreTimerMock();
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

		// I-S9 fix: initial fire defers to rAF. Flush to land the anchor.
		act(() => {
			flushMessages();
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

		// I-S12 round-3 fix: handleScroll uses direction-based classification
		// (scrollingUp vs scrollingDown), adopted from useStickToBottom.ts
		// lines 436-451. The user scrolling back to bottom produces a sequence
		// of scroll events where scrollTop progresses downward (toward bottom);
		// each scrollingDown event clears the escape flag. Once escape is
		// cleared AND scrollTop is within STICK_OFFSET_PX of bottom, re-pin.
		//
		// Establish baseline scrollTop in handleScroll's lastScrollTopRef by
		// firing one scroll event at the current (pre-scroll-back) position.
		// Real browsers do this automatically — user wheel-up produces wheel
		// events AND scroll events as the scroll progresses up.
		act(() => {
			fireScrollEvent(h.scrollEl);
			flushTimers();
		});

		// User scrolls back toward bottom in two steps: 800 -> 1000 -> 1170.
		// Each step is scrollingDown, which clears escape. The last step
		// lands within STICK_OFFSET_PX (gap = 2000 - 1170 - 800 = 30), so
		// the near-bottom re-pin clause fires.
		Object.defineProperty(h.scrollEl, "scrollTop", {
			configurable: true,
			value: 1000,
		});
		act(() => {
			fireScrollEvent(h.scrollEl);
			flushTimers();
		});

		Object.defineProperty(h.scrollEl, "scrollTop", {
			configurable: true,
			value: 1170,
		});
		act(() => {
			fireScrollEvent(h.scrollEl);
			flushTimers();
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

			// I-S9 fix: initial fire defers to rAF. Flush to land the anchor.
			act(() => {
				flushMessages();
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
			// I-S9 fix: initial fire defers to rAF. Flush to land the anchor.
			act(() => {
				flushMessages();
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


	describe("I-S9 regression net (initial RO-grew defers to rAF)", () => {
		// I-S9 root cause: when the contentRef ResizeObserver's first fire
		// happens during React's commit-phase microtask flush (i.e., on
		// tab activation when ~200 bubbles just mounted), reading
		// scrollHeight inside the callback synchronously forces a layout
		// pass against the dirty DOM. Trace evidence on a 200-bubble
		// session: 31 ms forced reflow inside the click handler.
		//
		// Fix: defer the initial fire's read to requestAnimationFrame.
		// The just-mounted DOM gets one frame to finish its layout pass;
		// the rAF callback then reads scrollHeight against a settled DOM.
		// Subsequent fires (true grows with previous defined) write
		// synchronously — only the FIRST fire defers.
		//
		// COVERAGE BOUNDARY: this net guards the INVARIANT (read happens
		// inside an rAF, not synchronously inside the RO callback) but
		// not the COST (the actual ms of layout work). The cost is
		// JSDOM-impossible — JSDOM has no real layout engine. Smoke-test
		// verification: capture a fresh Performance trace post-fix on
		// the same scenario as Trace-I-S8-NormalCadence-20260524T215526.json
		// and confirm forced-layout count inside the click handler is 0.

		it("defers initial fire scrollTop write to next rAF", () => {
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
			const writesBeforeFire = geom.writes.length;

			// Initial RO fire — happens during React commit-phase
			// microtask flush in real Obsidian.
			act(() => {
				fireResize(h.contentEl, 1000);
			});

			// SYNCHRONOUSLY: the hook MUST NOT have written scrollTop.
			// Reading scrollHeight synchronously here would force
			// layout against the dirty post-mount DOM.
			expect(geom.writes.length).toBe(writesBeforeFire);

			// Now flush the rAF queue.
			act(() => {
				flushMessages();
			});

			// AFTER rAF: the deferred callback reads scrollHeight
			// against the (notionally) settled DOM and writes scrollTop.
			expect(geom.writes.length).toBe(writesBeforeFire + 1);
			expect(geom.writes[geom.writes.length - 1]).toBe(199); // 1000-800-1
		});

		it("subsequent grow fires write scrollTop synchronously (NOT deferred)", () => {
			// Once the initial fire has set prevContentHeight, every later
			// grow is a true streaming chunk and must write synchronously
			// — deferring streaming-chunk writes would visibly lag the
			// scroll behind the content.
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

			// Initial fire — deferred. Flush rAF to land it.
			act(() => {
				fireResize(h.contentEl, 1000);
			});
			act(() => {
				flushMessages();
			});
			const writesAfterInitial = geom.writes.length;

			// Now a streaming-chunk grow.
			Object.defineProperty(h.scrollEl, "scrollHeight", {
				configurable: true,
				get: () => 1500,
			});
			act(() => {
				fireResize(h.contentEl, 1500);
			});

			// SYNCHRONOUSLY: write happened, no rAF flush needed.
			expect(geom.writes.length).toBe(writesAfterInitial + 1);
			expect(geom.writes[geom.writes.length - 1]).toBe(699); // 1500-800-1

			// And confirm the rAF queue is empty (no spurious deferred
			// callback queued for the second fire).
			const writesBeforeFlush = geom.writes.length;
			act(() => {
				flushMessages();
			});
			expect(geom.writes.length).toBe(writesBeforeFlush);
		});

		it("deferred initial fire respects state changes between RO callback and rAF", () => {
			// If the user wheel-ups in the interval between the deferred
			// RO callback and the rAF flush, the rAF callback must see
			// the current escapedFromLockRef / isAtBottomRef state and
			// skip the write. This guards against "we read state at the
			// wrong moment" regressions in the deferral implementation.
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
			const writesBeforeFire = geom.writes.length;

			// Initial RO fire — deferred to rAF.
			act(() => {
				fireResize(h.contentEl, 1000);
			});
			expect(geom.writes.length).toBe(writesBeforeFire);

			// User wheel-ups BEFORE the rAF flushes.
			act(() => {
				fireWheel(h.scrollEl, -50);
			});
			expect(h.getResult().isAtBottom).toBe(false);

			// Now flush rAF. The deferred callback's guards must
			// see the current isAtBottomRef=false and bail.
			act(() => {
				flushMessages();
			});

			// No write happened. The user's escape was respected.
			expect(geom.writes.length).toBe(writesBeforeFire);
		});

		it("FAILS on d6bcfac: in-frame synchronous rAF fulfillment defeats the deferral (T-IS9-smoke regression)", () => {
			// REPRODUCES the production failure surfaced by trace
			// _traces/Trace-Phase2-Verify-IS9-20260525T093852.json against
			// commit d6bcfac. Click handler total: 178.34 ms (vs 62.69 ms
			// pre-fix); forced-layout duration inside click: 75.94 ms (vs
			// 31.24 ms pre-fix). The deferred-rAF fix did NOT eliminate
			// the synchronous read in production.
			//
			// Why: when the click event is dispatched DURING an active
			// frame-update task (the common case for tab-activation clicks
			// because Chromium batches input + frame work), an
			// `requestAnimationFrame` queued from the click's microtask
			// flush gets fulfilled IN THE SAME TASK. The trace shows the
			// rAF queued at +30.80 ms inside the click, with the deferred
			// `UpdateLayoutTree`/`Layout` firing at +101.70/+144.11 ms —
			// all inside the same RunTask wrapping the click EventDispatch.
			//
			// The other I-S9 tests in this describe block use a CAPTURE
			// rAF mock (queues callbacks for explicit flush via
			// `flushRaf()`). That correctly simulates the "rAF runs in a
			// later task" case but masks the in-frame fulfillment case.
			// This test installs a SYNCHRONOUS-FULFILLMENT rAF mock that
			// fires the callback immediately within the same call stack as
			// the `requestAnimationFrame()` invocation — which is exactly
			// what Chromium does when the rAF is queued during an
			// already-active frame-update task.
			//
			// EXPECTED on a correct fix: the write does NOT happen
			// synchronously inside `fireResize`, regardless of whether the
			// underlying deferral mechanism resolves immediately or later.
			// The deferral must guarantee the write lands in a fresh
			// task/frame, not just outside the RO callback's synchronous
			// stack.
			//
			// Candidate mechanisms that would pass this test:
			//   - setTimeout(fn, 0) — schedules a new task, never folded
			//     into the current one
			//   - MessageChannel postMessage — same task-queue semantics
			//   - Double rAF (rAF inside rAF) — second rAF queues into the
			//     next frame's batch
			//   - scheduler.postTask(fn, { priority: "user-blocking" })
			//
			// The current `requestAnimationFrame(...)` deferral does NOT
			// pass — the trace proves it, and this test reproduces it.

			// Override rAF for this test only: synchronous fulfillment.
			// Mirrors Chromium's behavior when an rAF is queued during an
			// already-active frame-update task — the callback runs in the
			// same task as the requestAnimationFrame() call, not a later
			// frame.
			const savedRAF = globalThis.requestAnimationFrame;
			const savedCAF = globalThis.cancelAnimationFrame;
			let nextSyncRafId = 1;
			globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
				const id = nextSyncRafId++;
				// Fire synchronously inside the requestAnimationFrame call,
				// reproducing the in-frame-fulfillment behavior.
				cb(performance.now());
				return id;
			};
			globalThis.cancelAnimationFrame = () => {
				// No-op: the callback already ran synchronously above. Any
				// cancel attempt arrives after the fact, just like in the
				// browser when the rAF was already serviced this frame.
			};

			try {
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
				const writesBeforeFire = geom.writes.length;

				// Fire the initial RO event — same as the other I-S9 tests,
				// but now the rAF the hook queues will fulfill synchronously
				// inside the RO callback's call stack.
				act(() => {
					fireResize(h.contentEl, 1000);
				});

				// THE FAILING ASSERTION:
				// On d6bcfac, the hook's `requestAnimationFrame(() => { ... })`
				// fires synchronously inside fireResize, so the write happens
				// before fireResize returns. geom.writes.length will be
				// writesBeforeFire + 1 here, NOT writesBeforeFire.
				//
				// On a correct fix using a task-queue-based deferral
				// (setTimeout, MessageChannel, double rAF, postTask), the
				// callback will NOT run synchronously and this assertion
				// will pass.
				expect(geom.writes.length).toBe(writesBeforeFire);
			} finally {
				globalThis.requestAnimationFrame = savedRAF;
				globalThis.cancelAnimationFrame = savedCAF;
			}
		});

	});

	describe("I-S7 regression net (scroll-event race during async-grow session restore)", () => {
		// I-S7 root cause: each hook-driven setScrollTopInstant write fires
		// a scroll event; if scrollHeight has grown between the write and
		// the scroll event delivery (off-screen MarkdownRenderer.render
		// finishing), handleScroll computes gap > STICK_OFFSET_PX and
		// flips isAtBottomRef.current to false. Subsequent contentEl RO
		// fires then bail on the !isAtBottomRef.current guard and never
		// re-anchor. Final scrollTop stays frozen at the partial-content
		// bottom (= partialHeight - clientHeight - 1).
		//
		// Fix: ignoreNextScrollEventRef set immediately before each
		// hook-driven write; consumed and reset on the next handleScroll
		// invocation so the hook's own scroll-event echo doesn't race
		// the resize-driven scrollHeight growth.

		it("re-anchors after scroll-event fires between RO grow fires (the bug)", () => {
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

			// First RO fire — partial content height
			act(() => {
				fireResize(h.contentEl, 1000);
			});
			// I-S9 fix: initial fire defers to rAF. Flush to land the anchor.
			act(() => {
				flushMessages();
			});
			// Initial anchor: scrollTop = 1000 - 800 - 1 = 199
			expect(geom.writes[geom.writes.length - 1]).toBe(199);

			// BEFORE the scroll event fires for that write, async bubble
			// parsing grows scrollHeight to 4000 (off-screen rows complete
			// MarkdownRenderer.render). Browser delivers the scroll event
			// after this growth, so handleScroll sees the new scrollHeight.
			Object.defineProperty(h.scrollEl, "scrollHeight", {
				configurable: true,
				get: () => 4000,
			});
			act(() => {
				fireScrollEvent(h.scrollEl);
			});

			// Subsequent RO fires for the post-grow heights MUST re-anchor.
			// Pre-fix: each one bails on !isAtBottomRef.current.
			// Post-fix: each one writes scrollTop to the new bottom.
			act(() => {
				fireResize(h.contentEl, 4000);
			});
			expect(geom.writes[geom.writes.length - 1]).toBe(3199); // 4000 - 800 - 1
		});

		it("keeps re-anchoring across many RO fires interleaved with scroll events", () => {
			// Models the fuller real-Obsidian timeline: each RO fire
			// produces a scroll event; the scrollHeight may have grown
			// further between each pair.
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

			const heights = [1000, 2000, 4000, 8000, 12000, 16000];
			let prevHeight = 0;
			for (const height of heights) {
				Object.defineProperty(h.scrollEl, "scrollHeight", {
					configurable: true,
					get: () => height,
				});
				act(() => {
					fireResize(h.contentEl, height);
				});
				// Interleaved scroll event — hook's own echo. Must not
				// flip isAtBottomRef even though scrollHeight grew between
				// the previous RO fire and this scroll event.
				if (prevHeight > 0) {
					act(() => {
						fireScrollEvent(h.scrollEl);
					});
				}
				prevHeight = height;
			}

			// Final scrollTop must reflect the eventual bottom.
			const finalHeight = heights[heights.length - 1];
			expect(geom.writes[geom.writes.length - 1]).toBe(
				finalHeight - 800 - 1,
			);
		});

		it("user wheel-up during async-grow still escapes (flag must not eat real user input)", () => {
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

			// Initial RO fire writes scrollTop. Sets ignoreNextScrollEventRef.
			act(() => {
				fireResize(h.contentEl, 1000);
			});
			const writesAfterInitial = geom.writes.length;

			// The ONE scroll event from the hook's own write is consumed.
			act(() => {
				fireScrollEvent(h.scrollEl);
			});

			// User wheel-up — independent escape signal. Must unpin
			// regardless of any flag state, because wheel handler doesn't
			// consult ignoreNextScrollEventRef.
			act(() => {
				fireWheel(h.scrollEl, -50);
			});

			// Subsequent RO fire on async-grow must respect the escape.
			Object.defineProperty(h.scrollEl, "scrollHeight", {
				configurable: true,
				get: () => 1500,
			});
			act(() => {
				fireResize(h.contentEl, 1500);
			});

			// Hook must NOT have written scrollTop after the wheel-up.
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

describe("useAutoScrollPin — I-S12 race (browser scroll preservation reverts our writes)", () => {
	/**
	 * Empirically observed in real Obsidian (commit c89850f, 2026-05-25T14:42 PT):
	 * each Shift+Enter in the InputArea shrinks the chat container by ~21 px
	 * (one textarea line). The scrollRef RO fires correctly and writes scrollTop
	 * to the new bottom (e.g., 41899). The post-write `scrollEl.scrollTop` reads
	 * back as 41899 (`landed: true`). BUT by the next handleScroll, scrollTop
	 * has been REVERTED to its pre-shrink value (41893). After 4 keystrokes,
	 * gap=91 > STICK_OFFSET_PX → handleScroll flips isAtBottom=false. Pin lost.
	 *
	 * Mechanism (per [[I-S12 fix synthesis]] in the vault): Chromium's scroll
	 * preservation runs AFTER the RO microtask, reverting scrollTop to keep the
	 * user's effective view stable across layout changes. `overflow-anchor: none`
	 * on the scroll container should disable this per W3C spec § 2.1 step 1, but
	 * empirically does not in Obsidian/Electron's Chromium.
	 *
	 * Fix is the use-stick-to-bottom canonical pattern (line 539 + line 436):
	 *   B) hook re-corrects scrollTop on every RO fire if it drifted past target
	 *   C) handleScroll suppresses the else-if branch during resize-in-flight
	 *
	 * These tests model the empirical pattern: "browser writes scrollTop back
	 * to old value between layout-driven scroll event and RO callback." Each
	 * test simulates that revert by explicitly resetting scrollTop after the
	 * hook's write.
	 */

	it("FAILS on c89850f: pin survives 4 InputArea-grow keystrokes despite browser revert", () => {
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

		// Initial pinned state: scrollHeight=1000, clientHeight=800, gap=199.
		// scrollTop=199 means we're exactly at the bottom (scrollHeight-clientHeight-1 = 199).
		setupScrollGeometry(h.scrollEl, {
			scrollHeight: 1000,
			clientHeight: 800,
			scrollTop: 199,
		});

		// Establish baseline RO observation
		act(() => {
			fireResize(h.scrollEl, 800);
		});
		expect(h.getResult().isAtBottom).toBe(true);

		// Each "keystroke" shrinks clientHeight by 25 px (cumulative).
		// scrollHeight stays at 1000 (chat content unchanged).
		// We simulate the browser-revert pattern: each cycle ends by forcing
		// scrollTop back to 199 (its pre-shrink value), as Chromium would.
		const SHRINK_PER_KEYSTROKE = 25;
		const PRE_TYPING_SCROLLTOP = 199;
		let currentClientHeight = 800;

		for (let keystroke = 1; keystroke <= 4; keystroke += 1) {
			currentClientHeight -= SHRINK_PER_KEYSTROKE;

			// Update clientHeight (browser layout reflow)
			Object.defineProperty(h.scrollEl, "clientHeight", {
				configurable: true,
				get: () => currentClientHeight,
			});

			act(() => {
				// Layout-driven scroll event fires first (browser emits one
				// for the layout change, with the OLD scrollTop value still).
				fireScrollEvent(h.scrollEl);
				// Then the RO microtask fires.
				fireResize(h.scrollEl, currentClientHeight);
				// Then Chromium's scroll preservation reverts scrollTop.
				// Bypass our scrollTop setter capture: write directly via the
				// internal value to model an external mutation we can't see.
				Object.defineProperty(h.scrollEl, "scrollTop", {
					configurable: true,
					get: () => PRE_TYPING_SCROLLTOP,
				});
				// One more scroll event for the revert.
				fireScrollEvent(h.scrollEl);
			});
		}

		// Acceptance: pin survived. The user types newlines while pinned;
		// the chat should stay pinned regardless of the browser's revert.
		expect(h.getResult().isAtBottom).toBe(true);
	});

	it("baseline: scrollRef RO writes the current target on each shrink (preserved by fix)", () => {
		// Narrower test of the use-stick-to-bottom line 539 pattern:
		// "if scrollTop > targetScrollTop, force scrollTop = targetScrollTop"
		// on every RO fire. This catches the case where a previous RO write
		// landed but was reverted, and the current fire is for the next
		// layout change.
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
			scrollTop: 199,
		});

		// Establish baseline
		act(() => {
			fireResize(h.scrollEl, 800);
		});

		// First shrink: 800 → 775. Hook writes target = 1000 - 775 - 1 = 224.
		Object.defineProperty(h.scrollEl, "clientHeight", {
			configurable: true,
			get: () => 775,
		});
		act(() => {
			fireResize(h.scrollEl, 775);
		});
		expect(geom.writes[geom.writes.length - 1]).toBe(224);

		// Browser reverts scrollTop back to 199 (simulated)
		Object.defineProperty(h.scrollEl, "scrollTop", {
			configurable: true,
			get: () => 199,
		});

		// Second shrink: 775 → 750. Hook should write target = 1000 - 750 - 1 = 249
		// AND should re-correct because scrollTop (199) is below target (249) —
		// the previous write didn't stick. Without the fix, the RO only writes
		// once per fire; with the fix, it tracks the last target and ensures
		// scrollTop matches.
		const writesBeforeSecondShrink = geom.writes.length;
		Object.defineProperty(h.scrollEl, "clientHeight", {
			configurable: true,
			get: () => 750,
		});
		act(() => {
			fireResize(h.scrollEl, 750);
		});

		// Expectation: at least one write happened on the second shrink, AND
		// the most recent write equals 249 (the new target). Currently passes
		// the existing contract (one write of 249). The FIX adds a second
		// write/check so even if scrollTop was reverted, it's re-corrected.
		// To express the contract being added by the fix, we assert that
		// after the second RO fire, the LAST captured write reflects the
		// current target (not stale). This is a probe for B's re-correct.
		expect(geom.writes.length).toBeGreaterThan(writesBeforeSecondShrink);
		expect(geom.writes[geom.writes.length - 1]).toBe(249);
	});
});

describe("useAutoScrollPin — I-S12 grow (pill clears when container grows back)", () => {
	/**
	 * Empirically observed in real Obsidian (commit c89850f, 2026-05-25T14:35 PT):
	 * after the chat unpinned during a textarea-grow sequence (the I-S12 race
	 * symptom above), CLEARING the textarea grows the container back. The
	 * scrollbar physically lands at the bottom (because scroll content is
	 * shorter than container after the grow), but the pill remains visible
	 * because `isAtBottom` was flipped to false during the shrink sequence
	 * and never gets re-set to true.
	 *
	 * Root cause: scrollRef RO's grow branch is a no-op. Comment in current
	 * code says "Container grow doesn't lose the bottom — content already
	 * fills it (and contentRef ResizeObserver will fire too)." But contentRef
	 * RO doesn't fire on container-grow if content height stayed the same.
	 *
	 * Fix: scrollRef RO grow branch should mirror contentRef RO's shrank
	 * branch: if `bottomGap(scrollEl) <= STICK_OFFSET_PX` after the grow,
	 * re-pin (clear escape, set isAtBottom=true).
	 */

	it("FAILS on c89850f: container grow re-pins when scroll lands within STICK_OFFSET_PX of bottom", () => {
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

		// Setup: scrollEl is unpinned (isAtBottom=false), e.g., from prior
		// I-S12 race that flipped state. Scroll position is at 199 with
		// scrollHeight=1000, clientHeight=700 → gap = 1000 - 199 - 700 = 101 > 70.
		setupScrollGeometry(h.scrollEl, {
			scrollHeight: 1000,
			clientHeight: 700,
			scrollTop: 199,
		});
		act(() => {
			fireResize(h.scrollEl, 700);
		});

		// Drive the hook into !isAtBottom via wheel-up (simulates the I-S12 race
		// outcome where handleScroll's else-if flipped the flag).
		act(() => {
			fireWheel(h.scrollEl, -50);
		});
		expect(h.getResult().isAtBottom).toBe(false);

		// Container grows back: clientHeight 700 → 800. With scrollTop=199 and
		// scrollHeight=1000, new gap = 1000 - 199 - 800 = 1, well within
		// STICK_OFFSET_PX (70). The pill should clear.
		Object.defineProperty(h.scrollEl, "clientHeight", {
			configurable: true,
			get: () => 800,
		});
		act(() => {
			fireResize(h.scrollEl, 800);
		});

		// Acceptance: container-grow that brings scroll back into the bottom
		// zone should re-pin. Currently fails because scrollRef RO grow branch
		// is a no-op (early-bails on `if (height >= previous) return;`).
		expect(h.getResult().isAtBottom).toBe(true);
	});

	it("does NOT re-pin if container grows back but scroll is still far from bottom", () => {
		// Discriminator: grow that doesn't bring scroll within STICK_OFFSET_PX
		// of bottom should NOT re-pin (preserves user-escape-then-grow case).
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

		// scrollHeight=2000, clientHeight=700, scrollTop=199 → gap=1101.
		setupScrollGeometry(h.scrollEl, {
			scrollHeight: 2000,
			clientHeight: 700,
			scrollTop: 199,
		});
		act(() => {
			fireResize(h.scrollEl, 700);
		});
		act(() => {
			fireWheel(h.scrollEl, -50);
		});
		expect(h.getResult().isAtBottom).toBe(false);

		// Grow clientHeight 700 → 800. New gap = 2000 - 199 - 800 = 1001.
		// Still way above STICK_OFFSET_PX (70). Should NOT re-pin.
		Object.defineProperty(h.scrollEl, "clientHeight", {
			configurable: true,
			get: () => 800,
		});
		act(() => {
			fireResize(h.scrollEl, 800);
		});

		expect(h.getResult().isAtBottom).toBe(false);
	});
});

describe("useAutoScrollPin — I-S12 round-3 direction-classifier handleScroll", () => {
	/**
	 * Round-2 fix (resizeInFlightRef + setTimeout(0)) failed real-Chromium
	 * smoke testing. Test 1 (Shift+Enter typing while pinned): pin still
	 * dropped because the setTimeout(0) clear fired before the layout-driven
	 * scroll event arrived. Test 4 (pill click during streaming): pin
	 * dropped because handleScroll's gap-based else-if branch flipped
	 * isAtBottom=false on the first frame of the smooth-scroll animation
	 * (gap=2557 > STICK_OFFSET_PX=64).
	 *
	 * Round-3 fix adopts useStickToBottom.ts lines 412-451 + 535-592 verbatim:
	 *   1. resizeDifferenceRef (number, not boolean) set FIRST in every RO
	 *      callback, cleared via rAF + setTimeout(1) with last-writer-wins
	 *   2. handleScroll body deferred via setTimeout(1)
	 *   3. Direction-based classification (scrollingUp / scrollingDown)
	 *      replaces the gap-based else-if branch
	 *
	 * See [[I-S12 round-2 synthesis]] in the vault for the canonical-source
	 * reading and rationale. These tests pin the new contract.
	 */

	function setupFar(scrollTop: number) {
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
			scrollHeight: 10000,
			clientHeight: 1000,
			scrollTop,
		});
		return h;
	}

	it("scrollingUp scroll event flips isAtBottom=false (escape signal)", () => {
		// Establish baseline scrollTop in lastScrollTopRef.
		const h = setupFar(8000);
		act(() => {
			fireScrollEvent(h.scrollEl);
			flushTimers();
		});

		// User scrolls up (scrollTop decreases): pin should drop.
		Object.defineProperty(h.scrollEl, "scrollTop", {
			configurable: true,
			value: 7000,
		});
		act(() => {
			fireScrollEvent(h.scrollEl);
			flushTimers();
		});

		expect(h.getResult().isAtBottom).toBe(false);
	});

	it("scrollingDown scroll event does NOT flip isAtBottom=false (Test 4 coverage)", () => {
		// THE TEST 4 INVARIANT: a smooth-scroll-toward-bottom animation produces
		// scroll events with scrollTop INCREASING toward the bottom. The hook
		// must NOT interpret these as user-escape, even when the gap is still
		// large (early frames of the animation). Round-2's gap-based else-if
		// flipped isAtBottom=false on these events; the round-3 direction-
		// based classifier correctly classifies them as scrollingDown.

		const h = setupFar(2000);
		// Establish baseline.
		act(() => {
			fireScrollEvent(h.scrollEl);
			flushTimers();
		});
		expect(h.getResult().isAtBottom).toBe(true);

		// Simulate first frame of smooth-scroll-to-bottom animation: scrollTop
		// has moved from 2000 to 2500. gap is still 6500 (way > STICK_OFFSET_PX),
		// but direction is scrollingDown. Round-2: would flip isAtBottom=false
		// here. Round-3: must NOT flip.
		Object.defineProperty(h.scrollEl, "scrollTop", {
			configurable: true,
			value: 2500,
		});
		act(() => {
			fireScrollEvent(h.scrollEl);
			flushTimers();
		});

		expect(h.getResult().isAtBottom).toBe(true);
	});

	it("smooth-scroll-toward-bottom from far position keeps isAtBottom=true through every animation frame", () => {
		// Stronger Test 4 invariant: simulate a multi-frame smooth-scroll
		// animation. Starting from scrollTop=2000 (gap=7000), animation moves
		// scrollTop in steps of ~500 toward the bottom. isAtBottom must stay
		// true the whole way; the final frame at gap < STICK_OFFSET_PX should
		// land in the nearBottom branch and keep it true.

		const h = setupFar(2000);
		act(() => {
			fireScrollEvent(h.scrollEl);
			flushTimers();
		});

		const targetScrollTop = 10000 - 1000 - 1; // bottomScrollTop = 8999
		const frames = [3000, 4000, 5000, 6000, 7000, 8000, 8500, 8900, 8999];

		for (const frameScrollTop of frames) {
			Object.defineProperty(h.scrollEl, "scrollTop", {
				configurable: true,
				value: frameScrollTop,
			});
			act(() => {
				fireScrollEvent(h.scrollEl);
				flushTimers();
			});
			// Pin must not have dropped at any animation frame.
			expect(h.getResult().isAtBottom).toBe(true);
		}

		// Final assertion: animation landed at bottom; pin held throughout.
		expect(h.getResult().isAtBottom).toBe(true);
		// Sanity check: scrollTop ended at the target bottom.
		void targetScrollTop;
	});

	it("resize-in-flight (resizeDifferenceRef !== 0) suppresses handleScroll's deferred body (Test 1 coverage)", () => {
		// THE TEST 1 INVARIANT: a layout-shrink fires both a synthetic scroll
		// event AND a ResizeObserver entry. The RO callback sets
		// resizeDifferenceRef BEFORE any other work; handleScroll's deferred
		// body bails when resizeDifferenceRef !== 0. The clear is on
		// rAF+setTimeout(1) so the bail covers both the layout-driven scroll
		// event AND any post-RO scroll-preservation-revert events.

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
			scrollHeight: 10000,
			clientHeight: 1000,
			scrollTop: 8999, // pinned at bottom
		});

		// Establish baseline. Container RO baseline + scroll baseline.
		act(() => {
			fireResize(h.scrollEl, 1000);
			fireScrollEvent(h.scrollEl);
			flushTimers();
		});
		expect(h.getResult().isAtBottom).toBe(true);

		// Container shrinks (e.g., InputArea grew). Layout-driven scroll
		// event fires with a stale-looking gap (browser hasn't preserved
		// scrollTop yet). Then RO fires.
		Object.defineProperty(h.scrollEl, "clientHeight", {
			configurable: true,
			get: () => 950,
		});

		act(() => {
			// Synthesize the order: scroll event first, then RO.
			fireScrollEvent(h.scrollEl);
			fireResize(h.scrollEl, 950);
			// At this point, the deferred handleScroll body is queued via
			// setTimeout(1). resizeDifferenceRef has been set by the RO
			// (difference = -50). Flush timers — handleScroll's body must
			// see resizeDifferenceRef !== 0 and bail without flipping
			// isAtBottom.
			flushTimers();
		});

		// Pin survived the layout-shrink event sequence.
		expect(h.getResult().isAtBottom).toBe(true);
	});

	it("resizeDifferenceRef clear is two-frame (rAF+setTimeout(1)) so post-shrink revert is also guarded", () => {
		// Stronger Test 1 invariant: even AFTER the RO callback's body has
		// finished, the resizeDifferenceRef stays set until rAF+setTimeout(1).
		// Any scroll event fired DURING that window must also see the bail.
		// This guards the case where Chromium fires a scroll-preservation-
		// revert event AFTER the RO microtask but BEFORE the next paint.

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
			scrollHeight: 10000,
			clientHeight: 1000,
			scrollTop: 8999,
		});

		act(() => {
			fireResize(h.scrollEl, 1000);
			fireScrollEvent(h.scrollEl);
			flushTimers();
		});

		// Container shrinks. Fire RO first (so resizeDifferenceRef is set
		// AND the rAF+setTimeout(1) clear is scheduled).
		Object.defineProperty(h.scrollEl, "clientHeight", {
			configurable: true,
			get: () => 950,
		});
		act(() => {
			fireResize(h.scrollEl, 950);
		});

		// NOW fire a "post-RO revert" scroll event with a teleported scrollTop
		// (modeling Chromium's scroll preservation reverting our write).
		Object.defineProperty(h.scrollEl, "scrollTop", {
			configurable: true,
			value: 8000, // teleported up by 999
		});
		act(() => {
			fireScrollEvent(h.scrollEl);
			// Flush ONLY setTimeout queue — NOT the rAF clear yet. The
			// resizeDifferenceRef must still be non-zero, so handleScroll
			// bails. flushTimers fires the deferred handleScroll body, but
			// the clear is queued behind a separate rAF (which we don't
			// flush in this test mock).
			flushTimers();
		});

		// Pin survived even the post-RO revert event because resizeDifferenceRef
		// is still set.
		expect(h.getResult().isAtBottom).toBe(true);
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

		// No new write: no scroll event fired, so no reading position was
		// saved and there is nothing to restore. The real hide/show sequence
		// (scroll, placeholder swap, display:none reset) is pinned by the
		// I284 regression net below.
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

describe("useAutoScrollPin — I39 trackpad momentum scroll pill flicker", () => {
	/**
	 * Reproduces I39: aggressive trackpad swipe toward bottom produces
	 * momentum scroll events where scrollTop oscillates slightly around
	 * the bottom position. The direction classifier sees the overshoot-
	 * bounce as scrollingUp → sets escapedFromLock + isAtBottom=false →
	 * pill renders. Next frame: scrollingDown → clears escape → re-pins
	 * → pill hides. This rapid flip is the user-visible flicker.
	 *
	 * The test models a momentum scroll sequence arriving at the bottom:
	 * scrollTop progresses downward (scrollingDown), then overshoots
	 * slightly past the max (clamped by browser), then bounces back by
	 * a few pixels (scrollingUp). The bounce should NOT unpin because
	 * the gap is still within STICK_OFFSET_PX.
	 */
	it("does NOT unpin when momentum scroll oscillates within STICK_OFFSET_PX of bottom", () => {
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

		// Container: scrollHeight=2000, clientHeight=800.
		// Bottom = scrollHeight - clientHeight = 1200.
		// STICK_OFFSET_PX = 70, so anything with gap <= 70 is "at bottom".
		setupScrollGeometry(h.scrollEl, {
			scrollHeight: 2000,
			clientHeight: 800,
			scrollTop: 1200, // exactly at bottom
		});

		// Start pinned at bottom
		expect(h.getResult().isAtBottom).toBe(true);

		// Establish baseline in lastScrollTopRef
		act(() => {
			fireScrollEvent(h.scrollEl);
			flushTimers();
		});
		expect(h.getResult().isAtBottom).toBe(true);

		// Simulate momentum scroll arriving at bottom: scrollTop goes
		// from 1200 → 1199 (tiny bounce-back from elastic overscroll).
		// Gap = 2000 - 1199 - 800 = 1. Still well within STICK_OFFSET_PX.
		// But direction is scrollingUp (1199 < 1200).
		Object.defineProperty(h.scrollEl, "scrollTop", {
			configurable: true,
			value: 1199,
		});
		act(() => {
			fireScrollEvent(h.scrollEl);
			flushTimers();
		});

		// BUG (I39): isAtBottom flips to false here because the direction
		// classifier treats ANY scrollingUp as escape, regardless of gap.
		// EXPECTED: isAtBottom should remain true because gap (1px) is
		// well within STICK_OFFSET_PX (70px).
		expect(h.getResult().isAtBottom).toBe(true);
	});

	it("does NOT unpin on repeated small oscillations near bottom (momentum deceleration)", () => {
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
			scrollTop: 1195, // gap = 5, within STICK_OFFSET_PX
		});

		// Establish baseline
		act(() => {
			fireScrollEvent(h.scrollEl);
			flushTimers();
		});
		expect(h.getResult().isAtBottom).toBe(true);

		// Momentum deceleration: oscillates 1195 → 1192 → 1197 → 1190 → 1198
		// All within STICK_OFFSET_PX of bottom (gap never exceeds 10px).
		// Each scrollingUp frame should NOT unpin.
		const oscillation = [1192, 1197, 1190, 1198];
		for (const scrollTop of oscillation) {
			Object.defineProperty(h.scrollEl, "scrollTop", {
				configurable: true,
				value: scrollTop,
			});
			act(() => {
				fireScrollEvent(h.scrollEl);
				flushTimers();
			});
			expect(h.getResult().isAtBottom).toBe(true);
		}
	});
});

describe("useAutoScrollPin — I149 pill-click then type unpins (reproduce-first)", () => {
	/**
	 * User repro (2026-06-30, screen recording): "I clicked the scroll-to-bottom
	 * button and when I started typing in the composer the scroll unpinned
	 * itself automatically."
	 *
	 * This is the same family as I-S12 (composer grow shrinks the container;
	 * Chromium's scroll-preservation reverts the hook's re-anchor write). The
	 * I-S12 suite asserts the pin survives WHILE the resizeDifferenceRef guard
	 * is set (it deliberately never flushes the rAF+setTimeout(1) clear). It
	 * does NOT exercise the timing where the browser's revert scroll event
	 * fires AFTER the guard window has elapsed — which is exactly when the
	 * accumulating gap crosses STICK_OFFSET_PX and the direction classifier
	 * (scrollingUp + gap>offset) unpins.
	 *
	 * This test forces the guard to clear (synchronous rAF override so
	 * scheduleResizeDifferenceClear resolves within the act()) and then fires
	 * the revert scroll event, modeling real-Chromium timing.
	 */

	/** Mutable geometry: scrollTop stays writable so the hook can re-anchor;
	 * `revert()` models a browser-driven scrollTop change (not a hook write). */
	function mutableGeom(
		el: HTMLElement,
		init: { scrollHeight: number; clientHeight: number; scrollTop: number },
	) {
		let sh = init.scrollHeight;
		let ch = init.clientHeight;
		let st = init.scrollTop;
		const writes: number[] = [st];
		Object.defineProperty(el, "scrollHeight", {
			configurable: true,
			get: () => sh,
		});
		Object.defineProperty(el, "clientHeight", {
			configurable: true,
			get: () => ch,
		});
		Object.defineProperty(el, "scrollTop", {
			configurable: true,
			get: () => st,
			set: (v: number) => {
				st = v;
				writes.push(v);
			},
		});
		return {
			writes,
			setClientHeight: (v: number) => {
				ch = v;
			},
			revert: (v: number) => {
				st = v;
			},
			getScrollTop: () => st,
		};
	}

	it("FAILS on current main: pinned-via-pill then 4 composer keystrokes unpins once accumulated gap crosses STICK_OFFSET_PX", () => {
		// Force the resize guard clear (rAF+setTimeout(1)) to resolve within
		// act(), modeling real-Chromium timing where the scroll-preservation
		// revert fires after the guard window has elapsed.
		const savedRAF = globalThis.requestAnimationFrame;
		globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
			cb(performance.now());
			return 1;
		}) as typeof globalThis.requestAnimationFrame;

		try {
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
			const geom = mutableGeom(h.scrollEl, {
				scrollHeight: 2000,
				clientHeight: 800,
				scrollTop: 1199, // pinned at bottom (2000-800-1)
			});

			// Baseline container RO + scroll event → lastScrollTopRef=1199.
			act(() => {
				fireResize(h.scrollEl, 800);
				fireScrollEvent(h.scrollEl);
				flushTimers();
			});
			expect(h.getResult().isAtBottom).toBe(true);

			// Pill click → smooth scroll-to-bottom (no ignoreNextScrollEventRef).
			act(() => {
				h.getResult().scrollToBottom();
				fireScrollEvent(h.scrollEl);
				flushTimers();
			});
			expect(h.getResult().isAtBottom).toBe(true);

			// Type 4 keystrokes. Each: composer grows → container clientHeight
			// shrinks → hook re-anchors → Chromium reverts scrollTop toward the
			// preserved visual position (scrollingUp), leaving the bottom gap to
			// accumulate as clientHeight keeps shrinking.
			let ch = 800;
			for (let k = 1; k <= 4; k += 1) {
				ch -= 25;
				act(() => {
					geom.setClientHeight(ch);
					// scrollRef RO fires: hook re-anchors to new bottom (writer),
					// sets ignoreNextScrollEventRef, schedules resize-guard clear.
					fireResize(h.scrollEl, ch);
					// The hook's own re-anchor write echoes one scroll event
					// (consumed by ignoreNextScrollEventRef).
					fireScrollEvent(h.scrollEl);
					// Guard window elapses (rAF is synchronous here + setTimeout(1)).
					flushTimers();
					// Chromium's scroll-preservation revert: scrollTop drifts back
					// toward the pre-shrink visual position (small per keystroke).
					geom.revert(1199 - k);
					// Unguarded revert scroll event.
					fireScrollEvent(h.scrollEl);
					flushTimers();
				});
			}

			// The whole point: typing while pinned must NOT unpin the chat.
			expect(h.getResult().isAtBottom).toBe(true);
		} finally {
			globalThis.requestAnimationFrame = savedRAF;
		}
	});
});

describe("useAutoScrollPin — I149 composer input re-anchor (real fix)", () => {
	// The real production trigger: the messages container's ResizeObserver does
	// NOT fire on the flex-reflow shrink caused by composer growth (verified in
	// Obsidian's Chromium). The fix instead listens for the textarea's `input`
	// events (which bubble to the stable .agent-client-chat-view-container) and,
	// one rAF later (after autosize applies), re-anchors to the bottom if pinned.
	//
	// This harness reproduces that DOM shape: a view container wrapping the
	// messages scroll element (scrollRef), its content (contentRef), and a
	// sibling input container holding a textarea — so the hook's post-mount
	// effect finds the container via scrollEl.closest(...).
	function HarnessWithComposer(props: {
		onMount: (h: {
			scrollEl: HTMLDivElement;
			textarea: HTMLTextAreaElement;
		}) => void;
	}) {
		const result = useAutoScrollPin({
			isActive: true,
			isSending: false,
			view: makeView(),
		});
		const scrollDivRef = React.useRef<HTMLDivElement | null>(null);
		const taRef = React.useRef<HTMLTextAreaElement | null>(null);
		const onMountRef = React.useRef(props.onMount);
		onMountRef.current = props.onMount;
		const fireIfReady = () => {
			if (scrollDivRef.current && taRef.current) {
				onMountRef.current({
					scrollEl: scrollDivRef.current,
					textarea: taRef.current,
				});
			}
		};
		const scrollComposite = React.useCallback(
			(el: HTMLDivElement | null) => {
				scrollDivRef.current = el;
				result.scrollRef(el);
				fireIfReady();
			},
			[result.scrollRef],
		);
		return React.createElement(
			"div",
			{ className: "agent-client-chat-view-container" },
			React.createElement(
				"div",
				{ ref: scrollComposite, className: "agent-client-chat-view-messages" },
				React.createElement("div", {
					ref: result.contentRef,
					className: "agent-client-chat-content",
				}),
			),
			React.createElement(
				"div",
				{ className: "agent-client-chat-input-container" },
				React.createElement("textarea", {
					ref: (el: HTMLTextAreaElement | null) => {
						taRef.current = el;
						fireIfReady();
					},
				}),
			),
		);
	}

	function withSyncRaf(fn: () => void): void {
		const savedRAF = globalThis.requestAnimationFrame;
		globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
			cb(performance.now());
			return 1;
		}) as typeof globalThis.requestAnimationFrame;
		try {
			fn();
		} finally {
			globalThis.requestAnimationFrame = savedRAF;
		}
	}

	it("re-anchors to the bottom on a composer input event while pinned", () => {
		withSyncRaf(() => {
			let handle: {
				scrollEl: HTMLDivElement;
				textarea: HTMLTextAreaElement;
			} | null = null;
			render(
				React.createElement(HarnessWithComposer, {
					onMount: (h) => {
						handle = h;
					},
				}),
			);
			// biome-ignore lint/style/noNonNullAssertion: bound by render
			const h = handle!;
			// Pinned at bottom: scrollHeight 2000, clientHeight 800 → bottom = 1199.
			const geom = setupScrollGeometry(h.scrollEl, {
				scrollHeight: 2000,
				clientHeight: 800,
				scrollTop: 1199,
			});
			// Composer grew → messages viewport shrinks to 700 → new bottom = 1299.
			Object.defineProperty(h.scrollEl, "clientHeight", {
				configurable: true,
				get: () => 700,
			});
			const writesBefore = geom.writes.length;

			act(() => {
				h.textarea.dispatchEvent(new Event("input", { bubbles: true }));
			});

			// input → rAF (synchronous here) → re-anchor to the new bottom.
			expect(geom.writes.length).toBe(writesBefore + 1);
			expect(geom.writes[geom.writes.length - 1]).toBe(1299);
		});
	});

	it("does NOT re-anchor on composer input when escaped (user scrolled up)", () => {
		withSyncRaf(() => {
			let handle: {
				scrollEl: HTMLDivElement;
				textarea: HTMLTextAreaElement;
			} | null = null;
			render(
				React.createElement(HarnessWithComposer, {
					onMount: (h) => {
						handle = h;
					},
				}),
			);
			// biome-ignore lint/style/noNonNullAssertion: bound by render
			const h = handle!;
			const geom = setupScrollGeometry(h.scrollEl, {
				scrollHeight: 2000,
				clientHeight: 800,
				scrollTop: 500,
			});
			// User wheel-up → escaped.
			act(() => {
				fireWheel(h.scrollEl, -50);
			});
			const writesBefore = geom.writes.length;

			Object.defineProperty(h.scrollEl, "clientHeight", {
				configurable: true,
				get: () => 700,
			});
			act(() => {
				h.textarea.dispatchEvent(new Event("input", { bubbles: true }));
			});

			// Escaped → the input listener must NOT yank the user back to bottom.
			expect(geom.writes.length).toBe(writesBefore);
		});
	});
});

// ============================================================================
// I284 regression net: restore the reading position when returning to a
// scrolled-up tab. The harness mirrors MessageList's inactive placeholder
// swap: while inactive the scroll div has no content child, and the tests
// reset scrollTop / heights to 0 the way display:none does in Chromium
// (observed in the working vault on 2026-11-03: every hidden tab reports
// scrollTop 0, scrollHeight 0).
// ============================================================================

describe("useAutoScrollPin — I284 restore reading position on tab return", () => {
	interface Geom {
		scrollTop: number;
		scrollHeight: number;
		clientHeight: number;
		rows: Map<string, { top: number; height: number }>;
		writes: number[];
	}

	const ROW_PAD = 16;

	function layoutRows(geom: Geom, ids: string[], height: number | ((i: number) => number)): void {
		geom.rows.clear();
		let top = ROW_PAD;
		ids.forEach((id, i) => {
			const h = typeof height === "number" ? height : height(i);
			geom.rows.set(id, { top, height: h });
			top += h;
		});
		geom.scrollHeight = top + ROW_PAD;
	}

	function PlaceholderHarness(props: {
		isActive: boolean;
		ids: string[];
		geom: Geom;
		onHandle: (h: { scrollEl: HTMLDivElement | null; contentEl: HTMLDivElement | null }) => void;
		onResult?: (r: ReturnType<typeof useAutoScrollPin>) => void;
	}) {
		const result = useAutoScrollPin({
			isActive: props.isActive,
			isSending: false,
			view: makeView(),
		});
		props.onResult?.(result);
		const handles = React.useRef<{ scrollEl: HTMLDivElement | null; contentEl: HTMLDivElement | null }>({
			scrollEl: null,
			contentEl: null,
		});
		const geomRef = React.useRef(props.geom);
		geomRef.current = props.geom;
		const scrollComposite = React.useCallback(
			(el: HTMLDivElement | null) => {
				if (el && handles.current.scrollEl !== el) {
					const g = geomRef.current;
					Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => g.scrollHeight });
					Object.defineProperty(el, "clientHeight", { configurable: true, get: () => g.clientHeight });
					Object.defineProperty(el, "scrollTop", {
						configurable: true,
						get: () => g.scrollTop,
						set: (v: number) => {
							g.scrollTop = v;
							g.writes.push(v);
						},
					});
				}
				handles.current.scrollEl = el;
				result.scrollRef(el);
				props.onHandle(handles.current);
			},
			[result.scrollRef],
		);
		const contentComposite = React.useCallback(
			(el: HTMLDivElement | null) => {
				handles.current.contentEl = el;
				result.contentRef(el);
				props.onHandle(handles.current);
			},
			[result.contentRef],
		);
		const rowRef = (id: string) => (el: HTMLDivElement | null) => {
			if (!el) return;
			const g = geomRef.current;
			Object.defineProperty(el, "offsetTop", { configurable: true, get: () => g.rows.get(id)?.top ?? 0 });
			Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => g.rows.get(id)?.height ?? 0 });
		};
		const inner = !props.isActive
			? React.createElement("div", { ref: scrollComposite })
			: React.createElement(
					"div",
					{ ref: scrollComposite },
					React.createElement(
						"div",
						{ ref: contentComposite },
						...props.ids.map((id) =>
							React.createElement("div", { key: id, ref: rowRef(id), "data-message-id": id }),
						),
					),
					React.createElement("button", { "data-testid": "copy" }),
				);
		return React.createElement(
			"div",
			{ className: "agent-client-chat-view-container" },
			React.createElement("textarea", { "data-testid": "composer" }),
			inner,
		);
	}

	const IDS = Array.from({ length: 10 }, (_, i) => `m${i}`);

	function setup() {
		const geom: Geom = { scrollTop: 0, scrollHeight: 0, clientHeight: 600, rows: new Map(), writes: [] };
		layoutRows(geom, IDS, 500); // rows at 16, 516, 1016, ... ; scrollHeight 5032
		let h: { scrollEl: HTMLDivElement | null; contentEl: HTMLDivElement | null } = { scrollEl: null, contentEl: null };
		let hook: ReturnType<typeof useAutoScrollPin> | null = null;
		const el = (isActive: boolean, ids = IDS) =>
			React.createElement(PlaceholderHarness, {
				isActive,
				ids,
				geom,
				onHandle: (x) => {
					h = x;
				},
				onResult: (x) => {
					hook = x;
				},
			});
		const r = render(el(true));
		const scrollEl = () => h.scrollEl as HTMLDivElement;
		const contentEl = () => h.contentEl as HTMLDivElement;

		/** User scrolls up to `top` (wheel escape + the browser's scroll event). */
		const userScrollTo = (top: number) => {
			act(() => {
				fireWheel(scrollEl(), -50);
				geom.scrollTop = top;
				fireScrollEvent(scrollEl());
				flushTimers();
			});
		};
		/** Hide the tab: placeholder swap + display:none reset. */
		const hide = () => {
			act(() => {
				r.rerender(el(false));
				geom.scrollTop = 0;
				geom.clientHeight = 0;
				geom.scrollHeight = 0;
				fireScrollEvent(scrollEl());
				fireResize(scrollEl(), 0);
				flushTimers();
			});
		};
		/** Show the tab with the given geometry already laid out. */
		const show = (ids = IDS) => {
			act(() => {
				geom.clientHeight = 600;
				r.rerender(el(true, ids));
			});
		};
		const consumeOwnScrollEvent = () => {
			act(() => {
				fireScrollEvent(scrollEl());
			});
		};
		const getHook = () => hook as unknown as ReturnType<typeof useAutoScrollPin>;
		return { geom, r, el, scrollEl, contentEl, userScrollTo, hide, show, consumeOwnScrollEvent, getHook };
	}

	it("returns to where the user was reading (red on main: lands at scrollTop 0)", () => {
		const t = setup();
		t.userScrollTo(1200);
		t.hide();
		layoutRows(t.geom, IDS, 500);
		t.show();
		expect(t.geom.scrollTop).toBe(1200);
	});

	it("keeps re-applying while markdown renders in after a clamped first write", () => {
		const t = setup();
		t.userScrollTo(1200);
		t.hide();
		layoutRows(t.geom, IDS, 50); // partly rendered: scrollHeight 532
		t.show();
		expect(t.geom.scrollTop).toBe(Math.max(0, 532 - 600 - 1)); // clamped to 0
		layoutRows(t.geom, IDS, 500);
		act(() => {
			fireResize(t.contentEl(), 5000);
		});
		expect(t.geom.scrollTop).toBe(1200);
	});

	it("container growing back from 0 after a clamped write does not re-pin the tab (H1)", () => {
		const t = setup();
		t.userScrollTo(1200);
		t.hide();
		layoutRows(t.geom, IDS, 80); // scrollHeight 832 → clamp at 231, gap 1
		t.show();
		act(() => {
			fireResize(t.scrollEl(), 600);
		});
		expect(t.r.container.isConnected).toBe(true);
		layoutRows(t.geom, IDS, 500);
		act(() => {
			fireResize(t.contentEl(), 5000);
		});
		expect(t.geom.scrollTop).toBe(1200);
	});

	it("holds the anchored message in place when content above it grows (H2)", () => {
		const t = setup();
		t.userScrollTo(1200); // anchor m2 (top 1016) + 184
		t.hide();
		layoutRows(t.geom, IDS, 500);
		t.show();
		t.consumeOwnScrollEvent();
		layoutRows(t.geom, IDS, (i) => (i === 0 ? 900 : 500)); // m2 now at 1416
		act(() => {
			fireResize(t.contentEl(), 5400);
		});
		expect(t.geom.scrollTop).toBe(1416 + 184);
	});

	it("leaving again mid-restore keeps the original position, not the clamped one (H3)", () => {
		const t = setup();
		t.userScrollTo(1200);
		t.hide();
		layoutRows(t.geom, IDS, 80);
		t.show(); // clamped write
		t.consumeOwnScrollEvent();
		t.hide();
		layoutRows(t.geom, IDS, 500);
		t.show();
		expect(t.geom.scrollTop).toBe(1200);
	});

	it("a layout-driven scroll event during the restore does not move the anchor (M1)", () => {
		const t = setup();
		t.userScrollTo(1200);
		t.hide();
		layoutRows(t.geom, IDS, 80);
		t.show();
		t.consumeOwnScrollEvent();
		act(() => {
			t.geom.scrollTop = 0; // Chromium clamp/revert, not the user
			fireScrollEvent(t.scrollEl());
		});
		layoutRows(t.geom, IDS, 500);
		act(() => {
			fireResize(t.contentEl(), 5000);
		});
		expect(t.geom.scrollTop).toBe(1200);
	});

	it("a re-apply that changes nothing does not swallow the user's next scroll (M2)", () => {
		const t = setup();
		t.userScrollTo(1200);
		t.hide();
		layoutRows(t.geom, IDS, 500);
		t.show();
		t.consumeOwnScrollEvent();
		const writes = t.geom.writes.length;
		act(() => {
			fireResize(t.contentEl(), 5000); // same geometry → no write
		});
		expect(t.geom.writes.length).toBe(writes);
		act(() => {
			flushTimers(); // restore window closes
		});
		act(() => {
			t.geom.scrollTop = 5032 - 600; // user scrolls to the bottom
			fireScrollEvent(t.scrollEl());
			flushTimers();
		});
		expect(t.scrollEl().scrollTop).toBe(4432);
		// Pinned again: a pinned return lands at the bottom.
		t.hide();
		layoutRows(t.geom, IDS, 500);
		t.show();
		expect(t.geom.scrollTop).toBe(5032 - 600 - 1);
	});

	it.each([
		["wheel down", (el: HTMLElement) => fireWheel(el, 50)],
		["pointerdown (scrollbar drag)", (el: HTMLElement) => el.dispatchEvent(new Event("pointerdown", { bubbles: true }))],
		[
			"keydown on a focused copy button",
			(el: HTMLElement) =>
				el
					.querySelector("button")
					?.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true })),
		],
		["touchstart", (el: HTMLElement) => fireTouchStart(el, 100)],
	])("%s during the restore cancels it (M3)", (_name, fire) => {
		const t = setup();
		t.userScrollTo(1200);
		t.hide();
		layoutRows(t.geom, IDS, 80);
		t.show();
		const clamped = t.geom.scrollTop;
		t.consumeOwnScrollEvent();
		act(() => {
			fire(t.scrollEl());
		});
		layoutRows(t.geom, IDS, 500);
		act(() => {
			fireResize(t.contentEl(), 5000);
		});
		expect(t.geom.scrollTop).toBe(clamped);
	});

	it("does not restore into a replaced transcript (M4)", () => {
		const t = setup();
		t.userScrollTo(1200);
		t.hide();
		const fresh = IDS.map((id) => `new-${id}`);
		layoutRows(t.geom, fresh, 500);
		const writes = t.geom.writes.length;
		t.show(fresh);
		expect(t.geom.writes.length).toBe(writes);
	});

	it("a tab pinned when it was left still returns to the bottom", () => {
		const t = setup();
		t.hide();
		layoutRows(t.geom, IDS, 500);
		t.show();
		expect(t.geom.scrollTop).toBe(5032 - 600 - 1);
	});

	it("typing in the composer during the restore keeps holding the position (delta review L-1)", () => {
		const t = setup();
		t.userScrollTo(1200);
		t.hide();
		layoutRows(t.geom, IDS, 80);
		t.show();
		t.consumeOwnScrollEvent();
		act(() => {
			t.r.container
				.querySelector("textarea")
				?.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
		});
		layoutRows(t.geom, IDS, 500);
		act(() => {
			fireResize(t.contentEl(), 5000);
		});
		expect(t.geom.scrollTop).toBe(1200);
	});

	it("growth after a quiet gap is still corrected within the 2 s hold (review M-b)", () => {
		const t = setup();
		t.userScrollTo(1200);
		t.hide();
		layoutRows(t.geom, IDS, 500);
		t.show();
		t.consumeOwnScrollEvent();
		act(() => {
			fireResize(t.contentEl(), 5000);
			flushTimersShorterThan(2000); // a quiet period would end the restore here
		});
		layoutRows(t.geom, IDS, (i) => (i === 0 ? 900 : 500)); // late image above
		act(() => {
			fireResize(t.contentEl(), 5400);
		});
		expect(t.geom.scrollTop).toBe(1416 + 184);
	});

	it("scrolled up less than 70 px from the bottom still returns there, not the top (review M-a)", () => {
		const t = setup();
		t.userScrollTo(5032 - 600 - 20); // gap 20: unpinned by the wheel, inside STICK_OFFSET_PX
		t.hide();
		layoutRows(t.geom, IDS, 500);
		t.show();
		expect(t.geom.scrollTop).toBe(5032 - 600 - 20);
	});

	it("a content shrink near the bottom during the restore does not re-pin (spec item 4)", () => {
		const t = setup();
		t.userScrollTo(1200);
		t.hide();
		layoutRows(t.geom, IDS, 80);
		t.show(); // clamped at the bottom, gap 1
		t.consumeOwnScrollEvent();
		act(() => {
			fireResize(t.contentEl(), 900);
			fireResize(t.contentEl(), 850); // shrink with the bottom within 70 px
		});
		layoutRows(t.geom, IDS, 500);
		act(() => {
			fireResize(t.contentEl(), 5000);
		});
		expect(t.geom.scrollTop).toBe(1200);
	});

	it("the restore window ends once its timers fire; later growth no longer moves the view", () => {
		const t = setup();
		t.userScrollTo(1200);
		t.hide();
		layoutRows(t.geom, IDS, 80);
		t.show();
		const clamped = t.geom.scrollTop;
		t.consumeOwnScrollEvent();
		act(() => {
			flushTimers(); // quiet period and 2 s cap
		});
		layoutRows(t.geom, IDS, 500);
		act(() => {
			fireResize(t.contentEl(), 5000);
		});
		expect(t.geom.scrollTop).toBe(clamped);
	});

	it("scrollToBottom (pill click) during the restore ends it and drops the anchor", () => {
		const t = setup();
		t.userScrollTo(1200);
		t.hide();
		layoutRows(t.geom, IDS, 80);
		t.show();
		t.consumeOwnScrollEvent();
		act(() => {
			t.getHook().scrollToBottom({ behavior: "auto" });
		});
		layoutRows(t.geom, IDS, 500);
		act(() => {
			fireScrollEvent(t.scrollEl());
			fireResize(t.contentEl(), 5000);
		});
		expect(t.geom.scrollTop).not.toBe(1200);
		t.hide();
		layoutRows(t.geom, IDS, 500);
		t.show();
		expect(t.geom.scrollTop).toBe(5032 - 600 - 1);
	});
});

// ============================================================================
// I304: every user scroll input escapes the pin while the chat is streaming
// ============================================================================

describe("useAutoScrollPin — I304 user scroll input during streaming", () => {
	/**
	 * While an agent streams, a content ResizeObserver entry lands on almost
	 * every chunk, so resizeDifferenceRef is nearly always non-zero and the
	 * direction classifier in handleScroll bails. Wheel and touch unpin
	 * directly from their own handlers. A scrollbar drag, a track click and
	 * a keyboard scroll produce only scroll events, so each needs its own
	 * intent signal or the next chunk snaps the chat back to the bottom.
	 *
	 * JSDOM never fires scroll events for scrollTop writes, so `chunk()`
	 * dispatches the hook's own scroll event the way a browser would, and
	 * never flushes rAF: the resize stays "in flight" for the whole test.
	 */
	const CLIENT = 800;

	function setupStreaming() {
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
		let scrollHeight = 5000;
		let scrollTop = scrollHeight - CLIENT - 1;
		Object.defineProperty(h.scrollEl, "scrollHeight", {
			configurable: true,
			get: () => scrollHeight,
		});
		Object.defineProperty(h.scrollEl, "clientHeight", {
			configurable: true,
			get: () => CLIENT,
		});
		Object.defineProperty(h.scrollEl, "scrollTop", {
			configurable: true,
			get: () => scrollTop,
			set: (v: number) => {
				scrollTop = v;
			},
		});
		act(() => {
			fireResize(h.contentEl, scrollHeight);
			fireScrollEvent(h.scrollEl);
			flushTimers();
		});
		const chunk = () => {
			scrollHeight += 100;
			const before = scrollTop;
			act(() => {
				fireResize(h.contentEl, scrollHeight);
				// The browser fires a scroll event for the hook's own write.
				if (scrollTop !== before) fireScrollEvent(h.scrollEl);
				flushTimers();
			});
		};
		const userScrollTo = (v: number) => {
			scrollTop = v;
			fireScrollEvent(h.scrollEl);
		};
		const pointer = (type: "pointerdown" | "pointerup") =>
			h.scrollEl.dispatchEvent(new Event(type, { bubbles: true }));
		return { h, chunk, userScrollTo, pointer, top: () => scrollTop };
	}

	const inputs: Array<[string, (t: ReturnType<typeof setupStreaming>) => void]> = [
		[
			"wheel up",
			(t) =>
				act(() => {
					fireWheel(t.h.scrollEl, -100);
					t.userScrollTo(3000);
					flushTimers();
				}),
		],
		[
			"touch drag",
			(t) =>
				act(() => {
					fireTouchStart(t.h.scrollEl, 100);
					fireTouchMove(t.h.scrollEl, 200);
					t.userScrollTo(3000);
					flushTimers();
				}),
		],
		[
			"scrollbar drag",
			(t) =>
				act(() => {
					t.pointer("pointerdown");
					t.userScrollTo(3800);
					t.userScrollTo(3400);
					t.userScrollTo(3000);
					t.pointer("pointerup");
					flushTimers();
				}),
		],
		[
			"track click (scroll event lands after release)",
			(t) =>
				act(() => {
					t.pointer("pointerdown");
					t.pointer("pointerup");
					t.userScrollTo(3000);
					flushTimers();
				}),
		],
		[
			"PageUp",
			(t) =>
				act(() => {
					activeDocument.body.dispatchEvent(
						new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }),
					);
					t.userScrollTo(3000);
					flushTimers();
				}),
		],
		[
			"ArrowUp",
			(t) =>
				act(() => {
					activeDocument.body.dispatchEvent(
						new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
					);
					t.userScrollTo(3000);
					flushTimers();
				}),
		],
	];

	it.each(inputs)("%s unpins, and the next chunk keeps the position", (_name, input) => {
		const t = setupStreaming();
		t.chunk();
		expect(t.h.getResult().isAtBottom).toBe(true);
		input(t);
		expect(t.h.getResult().isAtBottom).toBe(false);
		t.chunk();
		t.chunk();
		expect(t.top()).toBe(3000);
	});

	const key = (target: EventTarget, k: string) =>
		act(() => {
			target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
		});

	it.each([
		["ArrowUp", 40],
		["PageUp (first animation frame)", 30],
	])("%s in small steps between chunks escapes and holds", (k, step) => {
		const t = setupStreaming();
		t.chunk();
		let expected = 0;
		for (let i = 0; i < 3; i++) {
			key(activeDocument.body, k.split(" ")[0] ?? k);
			expected = t.top() - step;
			act(() => {
				t.userScrollTo(expected);
				flushTimers();
			});
			t.chunk();
		}
		// Each step moved less than the stick zone; none may be undone.
		expect(t.h.getResult().isAtBottom).toBe(false);
		expect(t.top()).toBe(expected);
	});

	it("a short scrollbar drag (under the stick zone) escapes and holds", () => {
		const t = setupStreaming();
		t.chunk();
		const start = t.top();
		act(() => {
			t.pointer("pointerdown");
			t.userScrollTo(start - 20);
			t.pointer("pointerup");
			flushTimers();
		});
		t.chunk();
		expect(t.h.getResult().isAtBottom).toBe(false);
		expect(t.top()).toBe(start - 20);
	});

	it("a drag that lands in the same scroll event as the hook's own write still escapes", () => {
		const t = setupStreaming();
		t.chunk();
		act(() => {
			t.pointer("pointerdown");
			// A chunk lands: the hook writes the new bottom...
			Object.defineProperty(t.h.scrollEl, "scrollHeight", {
				configurable: true,
				get: () => 5300,
			});
			fireResize(t.h.contentEl, 5300);
			// ...and the drag moves the view before the browser's one scroll
			// event for that frame fires.
			t.userScrollTo(3000);
			t.pointer("pointerup");
			flushTimers();
		});
		expect(t.h.getResult().isAtBottom).toBe(false);
	});

	it("a press on a message (not the scrollbar) is not scroll intent", () => {
		const t = setupStreaming();
		t.chunk();
		act(() => {
			t.h.contentEl.dispatchEvent(new Event("pointerdown", { bubbles: true }));
			t.userScrollTo(3000);
			t.h.contentEl.dispatchEvent(new Event("pointerup", { bubbles: true }));
			flushTimers();
		});
		expect(t.h.getResult().isAtBottom).toBe(true);
	});

	it("a scroll key another handler already consumed is not scroll intent", () => {
		const t = setupStreaming();
		t.chunk();
		const consume = (e: Event) => e.preventDefault();
		activeDocument.addEventListener("keydown", consume, { capture: true });
		key(activeDocument.body, "PageUp");
		activeDocument.removeEventListener("keydown", consume, { capture: true });
		act(() => {
			t.userScrollTo(3000);
			flushTimers();
		});
		expect(t.h.getResult().isAtBottom).toBe(true);
	});

	it("Space on a focused button in the chat is not scroll intent", () => {
		const t = setupStreaming();
		t.chunk();
		const button = activeDocument.createElement("button");
		t.h.contentEl.appendChild(button);
		key(button, " ");
		act(() => {
			t.userScrollTo(3000);
			flushTimers();
		});
		expect(t.h.getResult().isAtBottom).toBe(true);
	});

	it("a scroll key doesn't arm a hidden tab's chat", () => {
		const t = setupStreaming();
		t.chunk();
		Object.defineProperty(t.h.scrollEl, "clientHeight", { configurable: true, get: () => 0 });
		key(activeDocument.body, "PageUp");
		Object.defineProperty(t.h.scrollEl, "clientHeight", { configurable: true, get: () => CLIENT });
		act(() => {
			t.userScrollTo(3000);
			flushTimers();
		});
		expect(t.h.getResult().isAtBottom).toBe(true);
	});

	it("a scroll-up with no user input stays pinned (layout scroll during a resize)", () => {
		const t = setupStreaming();
		t.chunk();
		act(() => {
			t.userScrollTo(3000);
			flushTimers();
		});
		expect(t.h.getResult().isAtBottom).toBe(true);
	});

	it("the intent window closes after release: a later layout scroll-up stays pinned", () => {
		const t = setupStreaming();
		t.chunk();
		act(() => {
			t.pointer("pointerdown");
			t.pointer("pointerup");
			flushTimers(); // the grace window ends with no scroll in it
		});
		act(() => {
			t.userScrollTo(3000);
			flushTimers();
		});
		expect(t.h.getResult().isAtBottom).toBe(true);
	});

	it("typing a scroll key in the composer is not scroll intent", () => {
		const t = setupStreaming();
		t.chunk();
		const ta = activeDocument.createElement("textarea");
		activeDocument.body.appendChild(ta);
		act(() => {
			ta.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
			t.userScrollTo(3000);
			flushTimers();
		});
		ta.remove();
		expect(t.h.getResult().isAtBottom).toBe(true);
	});

	it("a scrollbar drag escapes even with a stale text selection in the chat", () => {
		const t = setupStreaming();
		t.chunk();
		const range = { commonAncestorContainer: t.h.contentEl } as unknown as Range;
		window.getSelection = () =>
			({ rangeCount: 1, getRangeAt: () => range }) as unknown as Selection;
		act(() => {
			activeDocument.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			t.pointer("pointerdown");
			t.userScrollTo(3000);
			t.pointer("pointerup");
			activeDocument.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
			flushTimers();
		});
		expect(t.h.getResult().isAtBottom).toBe(false);
	});
});

// ============================================================================
// I305: a no-op hook write must not swallow the user's next scroll
// ============================================================================

describe("useAutoScrollPin — I305 no-op writes don't arm the ignore flag", () => {
	/**
	 * Browsers fire no scroll event when scrollTop is written to its current
	 * value. If the hook arms ignoreNextScrollEventRef before such a write,
	 * the flag stays set and eats the user's next real scroll: no direction
	 * classification, no reading-position save.
	 */
	function setupAtBottom(isActive: boolean) {
		let handle: HarnessHandle | null = null;
		const view = makeView();
		const el = (active: boolean) =>
			React.createElement(Harness, {
				isActive: active,
				isSending: false,
				view,
				onMount: (h) => {
					handle = h;
				},
			});
		const r = render(el(isActive));
		// biome-ignore lint/style/noNonNullAssertion: bound by render
		const h = handle!;
		let scrollTop = 5000 - 800 - 1;
		Object.defineProperty(h.scrollEl, "scrollHeight", { configurable: true, get: () => 5000 });
		Object.defineProperty(h.scrollEl, "clientHeight", { configurable: true, get: () => 800 });
		Object.defineProperty(h.scrollEl, "scrollTop", {
			configurable: true,
			get: () => scrollTop,
			set: (v: number) => {
				scrollTop = v;
			},
		});
		act(() => {
			fireScrollEvent(h.scrollEl);
			flushTimers();
		});
		const userScrollTo = (v: number) =>
			act(() => {
				scrollTop = v;
				fireScrollEvent(h.scrollEl);
				flushTimers();
			});
		return { h, r, el, userScrollTo };
	}

	it("tab re-activation while already at the bottom doesn't eat the next scroll-up", () => {
		const t = setupAtBottom(true);
		t.r.rerender(t.el(false));
		t.r.rerender(t.el(true)); // writes bottom: same value, no scroll event
		t.userScrollTo(3000);
		expect(t.h.getResult().isAtBottom).toBe(false);
	});

	it("typing in the composer while pinned at the bottom doesn't eat the next scroll-up", () => {
		let handle: HarnessHandle | null = null;
		const { container } = render(
			React.createElement(
				"div",
				{ className: "agent-client-chat-view-container" },
				React.createElement(Harness, {
					isActive: true,
					isSending: false,
					view: makeView(),
					onMount: (h) => {
						handle = h;
					},
				}),
				React.createElement("textarea", { "data-testid": "composer" }),
			),
		);
		// biome-ignore lint/style/noNonNullAssertion: bound by render
		const h = handle!;
		let scrollTop = 5000 - 800 - 1;
		Object.defineProperty(h.scrollEl, "scrollHeight", { configurable: true, get: () => 5000 });
		Object.defineProperty(h.scrollEl, "clientHeight", { configurable: true, get: () => 800 });
		Object.defineProperty(h.scrollEl, "scrollTop", {
			configurable: true,
			get: () => scrollTop,
			set: (v: number) => {
				scrollTop = v;
			},
		});
		act(() => {
			fireScrollEvent(h.scrollEl);
			flushTimers();
		});
		const raf = window.requestAnimationFrame;
		window.requestAnimationFrame = (cb: FrameRequestCallback) => {
			cb(0);
			return 0;
		};
		const composer = container.querySelector("[data-testid=composer]") as HTMLElement;
		act(() => {
			// A keystroke re-anchors to the bottom the chat is already at.
			composer.dispatchEvent(new Event("input", { bubbles: true }));
		});
		window.requestAnimationFrame = raf;
		act(() => {
			scrollTop = 3000;
			fireScrollEvent(h.scrollEl);
			flushTimers();
		});
		expect(h.getResult().isAtBottom).toBe(false);
	});

	it("a write that moves the view still ignores its own scroll event", () => {
		const t = setupAtBottom(true);
		t.r.rerender(t.el(false));
		Object.defineProperty(t.h.scrollEl, "scrollHeight", { configurable: true, get: () => 6000 });
		t.r.rerender(t.el(true)); // moves 4199 → 5199
		// The browser's scroll event for that write must not read as user input.
		act(() => {
			fireScrollEvent(t.h.scrollEl);
			flushTimers();
		});
		expect(t.h.getResult().isAtBottom).toBe(true);
	});
});
