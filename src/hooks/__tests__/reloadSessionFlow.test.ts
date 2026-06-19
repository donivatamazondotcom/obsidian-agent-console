/**
 * Tests for `reloadSessionFlow` — the pure soft-reload orchestration behind the
 * header ↻ Reload control. Spec: `Agent Console Reload Control` (T1, T2, fallback).
 */
import { describe, it, expect, vi } from "vitest";
import { reloadSessionFlow } from "../reloadSessionFlow";

describe("reloadSessionFlow", () => {
	it("T1: resumes the same session when there is a session and the agent can resume", async () => {
		const resumeSameSession = vi.fn().mockResolvedValue(undefined);
		const freshSession = vi.fn().mockResolvedValue(undefined);

		const result = await reloadSessionFlow({
			sessionId: "s-1",
			canResume: true,
			resumeSameSession,
			freshSession,
		});

		expect(result).toEqual({ resumed: true });
		expect(resumeSameSession).toHaveBeenCalledWith("s-1");
		expect(freshSession).not.toHaveBeenCalled();
	});

	it("T2: creates a fresh session when the agent cannot resume (loadSession unsupported)", async () => {
		const resumeSameSession = vi.fn().mockResolvedValue(undefined);
		const freshSession = vi.fn().mockResolvedValue(undefined);

		const result = await reloadSessionFlow({
			sessionId: "s-1",
			canResume: false,
			resumeSameSession,
			freshSession,
		});

		expect(result).toEqual({ resumed: false });
		expect(resumeSameSession).not.toHaveBeenCalled();
		expect(freshSession).toHaveBeenCalledTimes(1);
	});

	it("creates a fresh session when there is no live session id", async () => {
		const resumeSameSession = vi.fn().mockResolvedValue(undefined);
		const freshSession = vi.fn().mockResolvedValue(undefined);

		const result = await reloadSessionFlow({
			sessionId: null,
			canResume: true,
			resumeSameSession,
			freshSession,
		});

		expect(result).toEqual({ resumed: false });
		expect(resumeSameSession).not.toHaveBeenCalled();
		expect(freshSession).toHaveBeenCalledTimes(1);
	});

	it("falls back to a fresh session when resume throws (degraded restore)", async () => {
		const resumeSameSession = vi
			.fn()
			.mockRejectedValue(new Error("session/load not supported"));
		const freshSession = vi.fn().mockResolvedValue(undefined);

		const result = await reloadSessionFlow({
			sessionId: "s-1",
			canResume: true,
			resumeSameSession,
			freshSession,
		});

		expect(result).toEqual({ resumed: false });
		expect(resumeSameSession).toHaveBeenCalledWith("s-1");
		expect(freshSession).toHaveBeenCalledTimes(1);
	});
});

describe("reloadSessionFlow — history-replay suppression (I86)", () => {
	it("I86: suppresses the agent's history replay during resume so the preserved transcript is not duplicated", async () => {
		// The local transcript is already on screen (soft reload preserves it).
		const transcript: string[] = ["u1", "a1"];
		let ignore = false;
		const setIgnoreUpdates = vi.fn((v: boolean) => {
			ignore = v;
		});
		// resumeSameSession internally awaits loadSession, which replays the
		// conversation as session/update events. The sink appends unless updates
		// are being ignored — exactly the ChatPanel message pipeline behaviour.
		const resumeSameSession = vi.fn(async () => {
			for (const m of ["u1", "a1"]) {
				if (!ignore) transcript.push(m);
			}
		});
		const freshSession = vi.fn().mockResolvedValue(undefined);

		const result = await reloadSessionFlow({
			sessionId: "s-1",
			canResume: true,
			resumeSameSession,
			freshSession,
			setIgnoreUpdates,
		});

		expect(result).toEqual({ resumed: true });
		// The replay must be suppressed: transcript unchanged, NOT duplicated.
		expect(transcript).toEqual(["u1", "a1"]);
		// Suppress before resume, release after (in finally).
		expect(setIgnoreUpdates).toHaveBeenNthCalledWith(1, true);
		expect(setIgnoreUpdates).toHaveBeenLastCalledWith(false);
	});

	it("I86: releases the ignore-updates suppression even when resume throws", async () => {
		let ignore = false;
		const setIgnoreUpdates = vi.fn((v: boolean) => {
			ignore = v;
		});
		const resumeSameSession = vi
			.fn()
			.mockRejectedValue(new Error("session/load failed"));
		const freshSession = vi.fn().mockResolvedValue(undefined);

		const result = await reloadSessionFlow({
			sessionId: "s-1",
			canResume: true,
			resumeSameSession,
			freshSession,
			setIgnoreUpdates,
		});

		expect(result).toEqual({ resumed: false });
		// Suppression must be released so post-reload updates flow normally.
		expect(ignore).toBe(false);
		expect(setIgnoreUpdates).toHaveBeenLastCalledWith(false);
	});
});
