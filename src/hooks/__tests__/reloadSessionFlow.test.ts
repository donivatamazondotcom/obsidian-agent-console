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
