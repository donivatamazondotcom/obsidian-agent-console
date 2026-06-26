/**
 * Unit tests for useLazySession (Slice 3 of Tab Persistence + Lazy Sessions).
 *
 * Pins the typing-as-intent debounce, send-click acquisition-trigger logic, restored-tab
 * fallback, sticky-session, and reset semantics from
 * [[ACP Tab Persistence Across Restarts]] § Session Lifecycle.
 *
 * Coverage map (per spec § Unit Tests → U01–U14):
 *
 *   U01  Hook starts in `idle` with no session
 *   U02  Single keystroke schedules debounced session/new after 200ms
 *   U03  Second keystroke within debounce window does NOT reset/duplicate timer
 *   U04  Full-delete before timer fires cancels the call
 *   U05  Successful session/new → `ready` with sessionId set
 *   U06  Failed session/new → `error`, sessionId stays null
 *   U07  Restored tab calls session/load (not session/new) on first keystroke
 *   U08  session/load failure falls through to session/new; isFallbackRecovery=true
 *   U09  Send-while-connecting does NOT flush internally; reaches `ready` (reducer owns flush)
 *   U10  Send-while-connecting then connecting → error: error surfaces; sendPrompt NOT called
 *   U11  Subsequent send after `ready` reuses sticky session
 *   U12  Reset returns to `idle`; releases sessionId
 *   U13  Sustained typing fires only one session/new across many keystrokes
 *   U14  Click-send when `error` retries reconnect (reducer flushes on ready)
 *
 * Mocking strategy (per spec § Unit Tests):
 *   - acquireNewSession / loadExistingSession / sendPrompt are vi.fn() at the
 *     `acp-client` boundary. The hook never imports AcpClient directly —
 *     ChatPanel adapts AcpClient → these callbacks at the integration layer.
 *   - useTabSessionState is the real Slice 2 hook (not mocked). Composing
 *     real hooks validates the "one source of truth" invariant in flight.
 *
 * Timing strategy:
 *   - vi.useFakeTimers() controls the 200ms debounce window.
 *   - vi.advanceTimersByTimeAsync(N) advances timers AND drains microtasks,
 *     which is what we need for assertions about post-acquisition state
 *     (the mock's resolved promise must land before assertions).
 *   - act(async () => { ... }) wraps state-mutating async work so React
 *     batches and the next read sees post-transition state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
	useLazySession,
	type UseLazySessionOptions,
} from "../useLazySession";

// ============================================================================
// Helpers
// ============================================================================

function makeOptions(
	overrides: Partial<UseLazySessionOptions> = {},
): UseLazySessionOptions {
	return {
		acquireNewSession: vi
			.fn()
			.mockResolvedValue({ ok: true, sessionId: "session-new-1" }),
		loadExistingSession: vi
			.fn()
			.mockResolvedValue({ ok: true, sessionId: "session-loaded-1" }),
		sendPrompt: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

// ============================================================================
// useLazySession — initial state (U01)
// ============================================================================

describe("useLazySession — initial state", () => {
	it("U01: starts in `idle` with no sessionId and isFallbackRecovery=false", () => {
		const { result } = renderHook(() => useLazySession(makeOptions()));
		expect(result.current.state).toBe("idle");
		expect(result.current.sessionId).toBeNull();
		expect(result.current.isFallbackRecovery).toBe(false);
	});
});

// ============================================================================
// useLazySession — fresh tab debounced trigger (Decisions #2, #8)
// ============================================================================

describe("useLazySession — fresh tab debounced trigger", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("U02: single keystroke fires session/new after 200ms debounce", async () => {
		const options = makeOptions();
		const { result } = renderHook(() => useLazySession(options));

		// Keystroke does NOT immediately call session/new — debounced.
		act(() => result.current.onComposerChange("h"));
		expect(options.acquireNewSession).not.toHaveBeenCalled();
		expect(result.current.state).toBe("idle");

		// Advance just under the debounce window — still no call.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(199);
		});
		expect(options.acquireNewSession).not.toHaveBeenCalled();

		// Cross the 200ms threshold — call fires, success → ready.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});
		expect(options.acquireNewSession).toHaveBeenCalledTimes(1);
		expect(result.current.state).toBe("ready");
		expect(result.current.sessionId).toBe("session-new-1");
	});

	it("U03: second keystroke within debounce window does NOT reset or duplicate the timer", async () => {
		const options = makeOptions();
		const { result } = renderHook(() => useLazySession(options));

		// First keystroke at t=0: schedule timer.
		act(() => result.current.onComposerChange("h"));

		// Second keystroke at t=100ms: timer must not be reset OR duplicated.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(100);
		});
		act(() => result.current.onComposerChange("hi"));

		// At t=200ms (200ms from first keystroke): if timer were anchored to
		// the FIRST keystroke (correct behavior), it has fired by now. If it
		// were reset on the second keystroke (wrong), it would not fire until
		// t=300ms. Asserting it fired exactly once at t=200ms pins the spec.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(100);
		});
		expect(options.acquireNewSession).toHaveBeenCalledTimes(1);

		// Advance well past where a duplicated timer would have fired —
		// still exactly one call, proving no duplication.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(500);
		});
		expect(options.acquireNewSession).toHaveBeenCalledTimes(1);
	});

	it("U04: full-delete before timer fires cancels the call", async () => {
		const options = makeOptions();
		const { result } = renderHook(() => useLazySession(options));

		act(() => result.current.onComposerChange("h"));
		// Half-way through debounce window — user deletes back to empty.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(100);
		});
		act(() => result.current.onComposerChange(""));

		// Advance past where the timer would have fired (t=200ms+) — no call.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(500);
		});
		expect(options.acquireNewSession).not.toHaveBeenCalled();
		expect(result.current.state).toBe("idle");
	});

	it("U05: successful session/new transitions to `ready` with sessionId set", async () => {
		const options = makeOptions({
			acquireNewSession: vi
				.fn()
				.mockResolvedValue({ ok: true, sessionId: "session-xyz" }),
		});
		const { result } = renderHook(() => useLazySession(options));

		act(() => result.current.onComposerChange("h"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});

		expect(result.current.state).toBe("ready");
		expect(result.current.sessionId).toBe("session-xyz");
		expect(result.current.isFallbackRecovery).toBe(false);
	});

	it("U06: failed session/new transitions to `error`; sessionId stays null", async () => {
		const options = makeOptions({
			acquireNewSession: vi
				.fn()
				.mockResolvedValue({ ok: false, error: new Error("nope") }),
		});
		const { result } = renderHook(() => useLazySession(options));

		act(() => result.current.onComposerChange("h"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});

		expect(result.current.state).toBe("error");
		expect(result.current.sessionId).toBeNull();
	});

	it("U13: sustained typing fires only one session/new across many keystrokes", async () => {
		const options = makeOptions();
		const { result } = renderHook(() => useLazySession(options));

		// Burst of keystrokes within the debounce window.
		act(() => result.current.onComposerChange("h"));
		act(() => result.current.onComposerChange("he"));
		act(() => result.current.onComposerChange("hel"));
		act(() => result.current.onComposerChange("hell"));
		act(() => result.current.onComposerChange("hello"));

		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});
		expect(options.acquireNewSession).toHaveBeenCalledTimes(1);
		expect(result.current.state).toBe("ready");

		// More keystrokes AFTER acquisition lands — sticky-session means no
		// new acquisition, regardless of how much the user types.
		act(() => result.current.onComposerChange("hello world"));
		act(() => result.current.onComposerChange("hello world!"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(500);
		});
		expect(options.acquireNewSession).toHaveBeenCalledTimes(1);
	});
});

// ============================================================================
// useLazySession — restored tab (Decisions #6, #7)
// ============================================================================

describe("useLazySession — restored tab", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("U07: restored tab calls session/load (not session/new) on first keystroke", async () => {
		const options = makeOptions();
		const { result } = renderHook(() =>
			useLazySession({
				...options,
				restoredSessionId: "session-saved-42",
			}),
		);

		act(() => result.current.onComposerChange("h"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});

		expect(options.loadExistingSession).toHaveBeenCalledTimes(1);
		expect(options.loadExistingSession).toHaveBeenCalledWith(
			"session-saved-42",
		);
		expect(options.acquireNewSession).not.toHaveBeenCalled();
		expect(result.current.state).toBe("ready");
		expect(result.current.sessionId).toBe("session-loaded-1");
		expect(result.current.isFallbackRecovery).toBe(false);
	});

	it("U08: session/load failure falls through to session/new automatically; no user prompt; isFallbackRecovery=true", async () => {
		const options = makeOptions({
			loadExistingSession: vi
				.fn()
				.mockResolvedValue({
					ok: false,
					error: new Error("session expired"),
				}),
			acquireNewSession: vi
				.fn()
				.mockResolvedValue({ ok: true, sessionId: "session-new-fallback" }),
		});
		const { result } = renderHook(() =>
			useLazySession({
				...options,
				restoredSessionId: "session-stale-99",
			}),
		);

		act(() => result.current.onComposerChange("h"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});

		// Both primitives were called — load first, then new on fallback.
		expect(options.loadExistingSession).toHaveBeenCalledTimes(1);
		expect(options.loadExistingSession).toHaveBeenCalledWith(
			"session-stale-99",
		);
		expect(options.acquireNewSession).toHaveBeenCalledTimes(1);

		// Final state is `ready` with the NEW session — fallback was silent.
		expect(result.current.state).toBe("ready");
		expect(result.current.sessionId).toBe("session-new-fallback");
		expect(result.current.isFallbackRecovery).toBe(true);
	});
});

// ============================================================================
// useLazySession — send-while-connecting queue (spec § Trigger 2)
// ============================================================================

describe("useLazySession — send-while-connecting (acquisition trigger only)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("U09: send-while-connecting does NOT flush internally; acquisition still reaches `ready` (the reducer owns the flush)", async () => {
		// Slow-resolving acquireNewSession lets us click send during the
		// `connecting` window.
		let resolveAcquire!: (
			result: { ok: true; sessionId: string } | { ok: false; error: Error },
		) => void;
		const acquireNewSession = vi.fn().mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveAcquire = resolve;
				}),
		);
		const options = makeOptions({ acquireNewSession });
		const { result } = renderHook(() => useLazySession(options));

		// Trigger acquisition; advance timer so fireAcquisition is invoked
		// but the mock promise hasn't resolved yet.
		act(() => result.current.onComposerChange("h"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});
		expect(result.current.state).toBe("connecting");
		expect(acquireNewSession).toHaveBeenCalledTimes(1);

		// Click send while still connecting — the hook no longer queues; the
		// queue-orchestration reducer holds the pending message. No sendPrompt.
		act(() => result.current.onSendClick("queued message"));
		expect(options.sendPrompt).not.toHaveBeenCalled();
		expect(result.current.state).toBe("connecting");

		// Resolve acquisition; the hook reaches `ready` WITHOUT flushing — the
		// consumer's connect-flush effect delivers, not this hook.
		await act(async () => {
			resolveAcquire({ ok: true, sessionId: "session-after-queue" });
			await vi.runAllTimersAsync();
		});

		expect(result.current.state).toBe("ready");
		expect(result.current.sessionId).toBe("session-after-queue");
		expect(options.sendPrompt).not.toHaveBeenCalled();
	});

	it("U10: send-while-connecting then connecting → error: error surfaces; sendPrompt NOT called", async () => {
		let resolveAcquire!: (
			result: { ok: true; sessionId: string } | { ok: false; error: Error },
		) => void;
		const acquireNewSession = vi.fn().mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveAcquire = resolve;
				}),
		);
		const options = makeOptions({ acquireNewSession });
		const { result } = renderHook(() => useLazySession(options));

		act(() => result.current.onComposerChange("h"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});
		expect(result.current.state).toBe("connecting");

		// Queue a message during connecting.
		act(() => result.current.onSendClick("ill-fated message"));
		expect(result.current.state).toBe("connecting");

		// Resolve with failure — queue must NOT flush.
		await act(async () => {
			resolveAcquire({ ok: false, error: new Error("boom") });
			await vi.runAllTimersAsync();
		});

		expect(result.current.state).toBe("error");
		expect(result.current.sessionId).toBeNull();
		expect(options.sendPrompt).not.toHaveBeenCalled();
	});
});

// ============================================================================
// useLazySession — sticky session and reset (Decision #4)
// ============================================================================

describe("useLazySession — sticky session and reset", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("U11: subsequent send after `ready` reuses sticky session (no re-acquisition)", async () => {
		const options = makeOptions();
		const { result } = renderHook(() => useLazySession(options));

		// Get to ready.
		act(() => result.current.onComposerChange("h"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});
		expect(result.current.state).toBe("ready");
		expect(options.acquireNewSession).toHaveBeenCalledTimes(1);

		// First send.
		await act(async () => {
			result.current.onSendClick("message one");
			await vi.runAllTimersAsync();
		});
		expect(options.sendPrompt).toHaveBeenCalledTimes(1);
		expect(options.sendPrompt).toHaveBeenLastCalledWith(
			"session-new-1",
			"message one",
		);

		// Second send — sticky session, no new acquisition.
		await act(async () => {
			result.current.onSendClick("message two");
			await vi.runAllTimersAsync();
		});
		expect(options.sendPrompt).toHaveBeenCalledTimes(2);
		expect(options.sendPrompt).toHaveBeenLastCalledWith(
			"session-new-1",
			"message two",
		);

		// Third send — still sticky.
		await act(async () => {
			result.current.onSendClick("message three");
			await vi.runAllTimersAsync();
		});
		expect(options.sendPrompt).toHaveBeenCalledTimes(3);
		expect(options.acquireNewSession).toHaveBeenCalledTimes(1);
	});

	it("U12: reset returns to `idle` and releases sessionId", async () => {
		const options = makeOptions();
		const { result } = renderHook(() => useLazySession(options));

		// Get to ready.
		act(() => result.current.onComposerChange("h"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});
		expect(result.current.state).toBe("ready");
		expect(result.current.sessionId).toBe("session-new-1");

		// Reset.
		act(() => result.current.reset());
		expect(result.current.state).toBe("idle");
		expect(result.current.sessionId).toBeNull();
		expect(result.current.isFallbackRecovery).toBe(false);
	});
});

// ============================================================================
// useLazySession — error retry (spec § Trigger 2)
// ============================================================================

describe("useLazySession — error retry", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("U14: click-send when `error` retries reconnect (the reducer, not the hook, flushes on ready)", async () => {
		// First call fails, second call (retry) succeeds.
		const acquireNewSession = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, error: new Error("first fail") })
			.mockResolvedValueOnce({
				ok: true,
				sessionId: "session-retry-success",
			});
		const options = makeOptions({ acquireNewSession });
		const { result } = renderHook(() => useLazySession(options));

		// Get into error state.
		act(() => result.current.onComposerChange("h"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});
		expect(result.current.state).toBe("error");
		expect(acquireNewSession).toHaveBeenCalledTimes(1);

		// Click send while in error — retries acquisition. The hook no longer
		// queues/flushes; the consumer's connect-flush delivers on ready.
		await act(async () => {
			result.current.onSendClick("retry message");
			await vi.runAllTimersAsync();
		});

		// Acquisition retried; reaches ready. The hook itself does NOT flush.
		expect(acquireNewSession).toHaveBeenCalledTimes(2);
		expect(result.current.state).toBe("ready");
		expect(result.current.sessionId).toBe("session-retry-success");
		expect(options.sendPrompt).not.toHaveBeenCalled();
	});
});

// ============================================================================
// useLazySession — recoverHistory (I72 on-demand restored-session load)
// ============================================================================

describe("useLazySession — recoverHistory (I72)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("loads the restored session on demand (loadExistingSession, not new)", async () => {
		const options = makeOptions();
		const { result } = renderHook(() =>
			useLazySession({
				...options,
				restoredSessionId: "session-recover-1",
			}),
		);

		act(() => result.current.recoverHistory());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});

		expect(options.loadExistingSession).toHaveBeenCalledTimes(1);
		expect(options.loadExistingSession).toHaveBeenCalledWith(
			"session-recover-1",
		);
		expect(options.acquireNewSession).not.toHaveBeenCalled();
		expect(result.current.state).toBe("ready");
		expect(result.current.sessionId).toBe("session-loaded-1");
	});

	it("is a no-op once a session is already live", async () => {
		const options = makeOptions();
		const { result } = renderHook(() =>
			useLazySession({
				...options,
				restoredSessionId: "session-recover-2",
			}),
		);

		// First recovery → session goes live.
		act(() => result.current.recoverHistory());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(options.loadExistingSession).toHaveBeenCalledTimes(1);

		// Second call must not re-acquire — session is sticky.
		act(() => result.current.recoverHistory());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(options.loadExistingSession).toHaveBeenCalledTimes(1);
		expect(options.acquireNewSession).not.toHaveBeenCalled();
	});
});
