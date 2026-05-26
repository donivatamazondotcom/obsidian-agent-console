/**
 * Unit tests for useTabSessionState (Slice 2 of Tab Persistence + Lazy Sessions).
 *
 * Pins the per-tab state machine from [[ACP Tab Persistence Across Restarts]]
 * § Tab Session State Machine. The hook is a pure state machine — no real
 * ACP client, no DOM, no agent connection. Transitions are driven by named
 * methods that consumers (useLazySession, ChatPanel, etc.) call in response
 * to ACP events.
 *
 * Coverage map (per spec § Unit Tests → U15–U24):
 *
 *   U15  New tab starts in `idle` state
 *   U16  `idle → connecting` on `session/{new|load}` start
 *   U17  `connecting → ready` on success
 *   U18  `connecting → error` on failure (after replay-fallback also fails)
 *   U19  `ready → busy` when agent starts processing a prompt
 *   U20  `busy → ready` on agent response complete
 *   U21  `ready → permission` on agent permission request
 *   U22  `permission → ready` on permission decision
 *   U23  All three subscribers (tab icon, send button, header) receive
 *        the same state on every transition (consistency invariant)
 *   U24  Restored tab with sessionId pre-set still starts in `idle`
 *        (does NOT auto-`connecting`)
 *
 * Why named transition methods (not `setState`)?
 *
 * Decision #11 of the spec calls for "one source of truth" — three UI
 * surfaces (tab icon, send button, header) read the same state. Named
 * methods (`startConnect`, `connectSucceeded`, `requestPermission`, …)
 * encode the legal moves of the state machine in API shape, making it
 * impossible for a caller to construct an invalid transition string at
 * the type level. Consumers calling these methods in response to ACP
 * events (e.g., `useLazySession` in Slice 3) document the lifecycle
 * inline.
 *
 * Strict transition gating (e.g., rejecting `endBusy()` from `idle`) is
 * deferred — Slice 3 integrates the real lifecycle and will validate
 * sequences at the boundary; Slice 2 only proves each transition method
 * mutates state correctly when called.
 */

import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
	useTabSessionState,
	type TabSessionState,
} from "../useTabSessionState";

// ============================================================================
// useTabSessionState — initial state
// ============================================================================

describe("useTabSessionState — initial state", () => {
	it("U15: defaults to `idle` when no options are passed", () => {
		const { result } = renderHook(() => useTabSessionState());
		expect(result.current.state).toBe<TabSessionState>("idle");
	});

	it("U24: stays `idle` after mount — no auto-`connecting` transition", () => {
		// Spec § Trigger 1: opening a tab is browse intent, not send intent.
		// A restored tab with a pre-known sessionId must NOT auto-acquire a
		// session on mount. Reconnection waits for typing intent (Slice 3).
		const { result } = renderHook(() => useTabSessionState());
		// Wait an event-loop tick to catch any deferred auto-transition.
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				expect(result.current.state).toBe<TabSessionState>("idle");
				resolve();
			}, 0);
		});
	});

	it("respects `initialState` option when provided (consumer responsibility)", () => {
		const { result } = renderHook(() =>
			useTabSessionState({ initialState: "ready" }),
		);
		expect(result.current.state).toBe<TabSessionState>("ready");
	});
});

// ============================================================================
// useTabSessionState — transitions
// ============================================================================

describe("useTabSessionState — transitions", () => {
	it("U16: `startConnect` transitions idle → connecting", () => {
		const { result } = renderHook(() => useTabSessionState());
		expect(result.current.state).toBe<TabSessionState>("idle");
		act(() => result.current.startConnect());
		expect(result.current.state).toBe<TabSessionState>("connecting");
	});

	it("U16: `startConnect` transitions error → connecting (retry path)", () => {
		const { result } = renderHook(() =>
			useTabSessionState({ initialState: "error" }),
		);
		act(() => result.current.startConnect());
		expect(result.current.state).toBe<TabSessionState>("connecting");
	});

	it("U17: `connectSucceeded` transitions connecting → ready", () => {
		const { result } = renderHook(() =>
			useTabSessionState({ initialState: "connecting" }),
		);
		act(() => result.current.connectSucceeded());
		expect(result.current.state).toBe<TabSessionState>("ready");
	});

	it("U18: `connectFailed` transitions connecting → error", () => {
		const { result } = renderHook(() =>
			useTabSessionState({ initialState: "connecting" }),
		);
		act(() => result.current.connectFailed());
		expect(result.current.state).toBe<TabSessionState>("error");
	});

	it("U19: `startBusy` transitions ready → busy", () => {
		const { result } = renderHook(() =>
			useTabSessionState({ initialState: "ready" }),
		);
		act(() => result.current.startBusy());
		expect(result.current.state).toBe<TabSessionState>("busy");
	});

	it("U20: `endBusy` transitions busy → ready", () => {
		const { result } = renderHook(() =>
			useTabSessionState({ initialState: "busy" }),
		);
		act(() => result.current.endBusy());
		expect(result.current.state).toBe<TabSessionState>("ready");
	});

	it("U21: `requestPermission` transitions ready → permission", () => {
		const { result } = renderHook(() =>
			useTabSessionState({ initialState: "ready" }),
		);
		act(() => result.current.requestPermission());
		expect(result.current.state).toBe<TabSessionState>("permission");
	});

	it("U21: `requestPermission` transitions busy → permission", () => {
		// Permission requests can also surface mid-prompt while busy.
		const { result } = renderHook(() =>
			useTabSessionState({ initialState: "busy" }),
		);
		act(() => result.current.requestPermission());
		expect(result.current.state).toBe<TabSessionState>("permission");
	});

	it("U22: `resolvePermission` transitions permission → ready", () => {
		const { result } = renderHook(() =>
			useTabSessionState({ initialState: "permission" }),
		);
		act(() => result.current.resolvePermission());
		expect(result.current.state).toBe<TabSessionState>("ready");
	});

	it("`reset` transitions any state → idle", () => {
		const states: TabSessionState[] = [
			"connecting",
			"ready",
			"busy",
			"permission",
			"error",
		];
		for (const initialState of states) {
			const { result } = renderHook(() =>
				useTabSessionState({ initialState }),
			);
			act(() => result.current.reset());
			expect(result.current.state).toBe<TabSessionState>("idle");
		}
	});
});

// ============================================================================
// useTabSessionState — consistency (U23)
// ============================================================================

describe("useTabSessionState — consistency", () => {
	it("U23: every reader sees the same state value within a render", () => {
		// Three "subscribers" simulate the tab icon, send button, and header
		// pulling state from the same hook instance. After any transition,
		// they must agree on the post-transition state.
		const { result } = renderHook(() => useTabSessionState());

		const readSubscriberA = () => result.current.state;
		const readSubscriberB = () => result.current.state;
		const readSubscriberC = () => result.current.state;

		expect(readSubscriberA()).toBe(readSubscriberB());
		expect(readSubscriberB()).toBe(readSubscriberC());

		act(() => result.current.startConnect());
		expect(readSubscriberA()).toBe<TabSessionState>("connecting");
		expect(readSubscriberB()).toBe<TabSessionState>("connecting");
		expect(readSubscriberC()).toBe<TabSessionState>("connecting");

		act(() => result.current.connectSucceeded());
		expect(readSubscriberA()).toBe<TabSessionState>("ready");
		expect(readSubscriberB()).toBe<TabSessionState>("ready");
		expect(readSubscriberC()).toBe<TabSessionState>("ready");

		act(() => result.current.startBusy());
		expect(readSubscriberA()).toBe<TabSessionState>("busy");
		expect(readSubscriberB()).toBe<TabSessionState>("busy");
		expect(readSubscriberC()).toBe<TabSessionState>("busy");

		act(() => result.current.requestPermission());
		expect(readSubscriberA()).toBe<TabSessionState>("permission");
		expect(readSubscriberB()).toBe<TabSessionState>("permission");
		expect(readSubscriberC()).toBe<TabSessionState>("permission");

		act(() => result.current.resolvePermission());
		expect(readSubscriberA()).toBe<TabSessionState>("ready");
		expect(readSubscriberB()).toBe<TabSessionState>("ready");
		expect(readSubscriberC()).toBe<TabSessionState>("ready");
	});

	it("U23: transition method identities are stable across renders", () => {
		// React-side concern: if transition method identities change every
		// render, every consumer using them in a useEffect dependency array
		// would re-fire on every render. Stable identities are the only
		// "one source of truth" guarantee that doesn't leak into perf bugs.
		const { result, rerender } = renderHook(() => useTabSessionState());
		const startConnectFirst = result.current.startConnect;
		const connectSucceededFirst = result.current.connectSucceeded;
		const requestPermissionFirst = result.current.requestPermission;

		rerender();
		expect(result.current.startConnect).toBe(startConnectFirst);
		expect(result.current.connectSucceeded).toBe(connectSucceededFirst);
		expect(result.current.requestPermission).toBe(requestPermissionFirst);

		// Identity must hold across an actual state transition, too.
		act(() => result.current.startConnect());
		expect(result.current.startConnect).toBe(startConnectFirst);
		expect(result.current.connectSucceeded).toBe(connectSucceededFirst);
	});
});
