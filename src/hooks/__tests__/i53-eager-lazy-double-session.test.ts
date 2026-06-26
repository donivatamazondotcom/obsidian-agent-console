/**
 * I53: Eager+lazy double session/new race — reproducing test.
 *
 * Models the race between a prior session creation (eager-init or prior lazy
 * fire) and a subsequent lazy-session `acquireNewSession` call.
 *
 * HISTORICAL NOTE (2026-06-25): the original fix added an `existingSid`
 * reuse-guard in ChatPanel's `acquireNewSession`. That guard was later REMOVED
 * by the Tab Agent Identity & Session Acquisition unification: moving
 * switch/new-chat onto the lazy owner eliminated the eager `createSession`
 * path that produced the second session/new, so the guard became redundant —
 * and it was actively harmful on Restart agent (it reused a just-closed
 * session id, hanging the tab on "Connecting"; see restart-respawn-fresh.test.ts).
 * These tests still validly exercise the HOOK contract (it faithfully returns
 * whatever acquireNewSession yields), so they are retained as hook-mechanics
 * regression guards — they no longer mirror ChatPanel's callback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
	useLazySession,
	type UseLazySessionOptions,
} from "../useLazySession";

describe("I53: eager+lazy double session/new race", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("acquireNewSession short-circuits when agent already has a session (I53 guard)", async () => {
		// Simulate the shared agent state that both the eager-init useEffect
		// and the lazy hook's acquireNewSession read from.
		const agentState = { sessionId: null as string | null };
		let sessionNewCallCount = 0;

		// The acquireNewSession callback as it exists AFTER the I53 fix:
		// it checks agentState.sessionId BEFORE calling createSession.
		const acquireNewSession = vi.fn(async () => {
			// I53 guard: check if session already exists
			if (agentState.sessionId) {
				return { ok: true as const, sessionId: agentState.sessionId };
			}
			// No existing session — create one (session/new RPC)
			sessionNewCallCount++;
			const sid = `session-lazy-${sessionNewCallCount}`;
			agentState.sessionId = sid;
			return { ok: true as const, sessionId: sid };
		});

		const options: UseLazySessionOptions = {
			acquireNewSession,
			loadExistingSession: vi
				.fn()
				.mockResolvedValue({ ok: true, sessionId: "unused" }),
			sendPrompt: vi.fn().mockResolvedValue(undefined),
		};

		const { result } = renderHook(() => useLazySession(options));

		// --- Simulate: eager-init (or prior lazy fire) already created a session ---
		agentState.sessionId = "session-eager";

		// --- User types → lazy debounce fires ---
		act(() => result.current.onComposerChange("h"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});

		// acquireNewSession WAS called (the hook works correctly)
		expect(acquireNewSession).toHaveBeenCalledTimes(1);

		// KEY ASSERTION: no new session/new RPC was issued because the
		// guard detected the existing session.
		expect(sessionNewCallCount).toBe(0);

		// The hook reports the existing session, not a duplicate.
		expect(result.current.state).toBe("ready");
		expect(result.current.sessionId).toBe("session-eager");
	});

	it("acquireNewSession creates a new session when none exists (normal path)", async () => {
		const agentState = { sessionId: null as string | null };
		let sessionNewCallCount = 0;

		const acquireNewSession = vi.fn(async () => {
			if (agentState.sessionId) {
				return { ok: true as const, sessionId: agentState.sessionId };
			}
			sessionNewCallCount++;
			const sid = `session-new-${sessionNewCallCount}`;
			agentState.sessionId = sid;
			return { ok: true as const, sessionId: sid };
		});

		const options: UseLazySessionOptions = {
			acquireNewSession,
			loadExistingSession: vi
				.fn()
				.mockResolvedValue({ ok: true, sessionId: "unused" }),
			sendPrompt: vi.fn().mockResolvedValue(undefined),
		};

		const { result } = renderHook(() => useLazySession(options));

		// No prior session exists — acquireNewSession should create one.
		act(() => result.current.onComposerChange("h"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});

		expect(acquireNewSession).toHaveBeenCalledTimes(1);
		expect(sessionNewCallCount).toBe(1);
		expect(result.current.state).toBe("ready");
		expect(result.current.sessionId).toBe("session-new-1");
	});
});
