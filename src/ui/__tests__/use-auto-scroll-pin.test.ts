/**
 * Unit tests for useAutoScrollPin.
 *
 * Coverage targets behaviors T100–T131 from the spec at
 * 04-initiatives/Agent Console/ACP Scroll Architecture Rework.md, with
 * each behavior testable at the hook level marked here. Behaviors
 * requiring real Obsidian (tab-switch flicker absence, real virtualizer
 * measurement, real leaf transitions) are noted as `test.todo()` and
 * verified manually via the smoke-test checklist.
 *
 * Test approach: render the hook with mock containerRef/virtualizerRef,
 * drive it through transitions (rerender with new props, fire scroll
 * events), and assert on `pinState` / `isPinned` / `shouldAdjust`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { App } from "obsidian";

import { useAutoScrollPin } from "../use-auto-scroll-pin";
import type { UseAutoScrollPinParams } from "../use-auto-scroll-pin.types";
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

		expect(virtualizer.scrollToIndex).toHaveBeenCalled();
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
