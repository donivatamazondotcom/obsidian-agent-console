/**
 * I44 regression guard + I43 conditional-suppression test for
 * loadExistingSessionFlow.
 *
 * I44 was verified manually (live sessionId matched persisted sessionId after
 * reconnect). Per SDLC "manual sign-off is not feature acceptance," this is
 * the automated guard for the real orchestration: loadSession is called,
 * replay suppression toggles only when local history is present, and
 * failures fall through.
 */
import { describe, it, expect, vi } from "vitest";
import { loadExistingSessionFlow } from "../loadExistingSessionFlow";
import type { SessionResult } from "../../types/session";

function sessionResult(id: string): SessionResult {
	return { sessionId: id };
}

describe("loadExistingSessionFlow", () => {
	it("I44: calls loadSession with sessionId + cwd and returns ok on success", async () => {
		const loadSession = vi.fn().mockResolvedValue(sessionResult("s-1"));
		const onLoaded = vi.fn();
		const setIgnoreUpdates = vi.fn();

		const result = await loadExistingSessionFlow({
			sessionId: "s-1",
			cwd: "/vault",
			haveLocalHistory: false,
			loadSession,
			onLoaded,
			setIgnoreUpdates,
		});

		expect(loadSession).toHaveBeenCalledWith("s-1", "/vault");
		expect(onLoaded).toHaveBeenCalledWith(sessionResult("s-1"));
		expect(result).toEqual({ ok: true, sessionId: "s-1" });
	});

	it("I43: suppresses replay (ignoreUpdates true→false) when local history is present", async () => {
		const calls: boolean[] = [];
		const setIgnoreUpdates = vi.fn((b: boolean) => calls.push(b));
		const loadSession = vi.fn().mockResolvedValue(sessionResult("s-2"));

		await loadExistingSessionFlow({
			sessionId: "s-2",
			cwd: "/vault",
			haveLocalHistory: true,
			loadSession,
			onLoaded: vi.fn(),
			setIgnoreUpdates,
		});

		expect(calls).toEqual([true, false]);
	});

	it("I43: does NOT touch ignoreUpdates when there is no local history (race path)", async () => {
		const setIgnoreUpdates = vi.fn();
		const loadSession = vi.fn().mockResolvedValue(sessionResult("s-3"));

		await loadExistingSessionFlow({
			sessionId: "s-3",
			cwd: "/vault",
			haveLocalHistory: false,
			loadSession,
			onLoaded: vi.fn(),
			setIgnoreUpdates,
		});

		expect(setIgnoreUpdates).not.toHaveBeenCalled();
	});

	it("returns ok:false and still releases suppression when loadSession throws", async () => {
		const calls: boolean[] = [];
		const setIgnoreUpdates = vi.fn((b: boolean) => calls.push(b));
		const loadSession = vi
			.fn()
			.mockRejectedValue(new Error("session expired"));

		const result = await loadExistingSessionFlow({
			sessionId: "s-dead",
			cwd: "/vault",
			haveLocalHistory: true,
			loadSession,
			onLoaded: vi.fn(),
			setIgnoreUpdates,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toBe("session expired");
		// suppression released even on failure
		expect(calls).toEqual([true, false]);
	});
});
