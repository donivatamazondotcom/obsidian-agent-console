/**
 * I237 — a paused tab that never had a message must reconnect with a plain
 * new session: there is no history to keep. Loading its kept id fails on
 * agents that store nothing for an empty session (Claude), which fell back to
 * a new session AND showed the "Session restored from history" notice on a
 * tab with no history.
 *
 * Seam (R2): the public `useLazySession` API with the real state machine;
 * only the acquisition callbacks (the ACP boundary) are faked (R4). Load
 * fails like Claude's does for an empty session. Assertions on which
 * acquisition ran and the fallback flag that drives the notice (R3).
 *
 * Spec: [[I237 Released empty tab shows a restored-from-history notice]].
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLazySession, type UseLazySessionOptions } from "../useLazySession";

function options(): UseLazySessionOptions {
	let n = 0;
	return {
		acquireNewSession: vi.fn(async () => {
			n += 1;
			return { ok: true as const, sessionId: `s${n}` };
		}),
		loadExistingSession: vi.fn(async () => ({
			ok: false as const,
			error: new Error("Resource not found"),
		})),
		sendPrompt: vi.fn().mockResolvedValue(undefined),
	};
}

async function readyTab(o: UseLazySessionOptions) {
	const hook = renderHook(() => useLazySession(o));
	await act(async () => {
		await hook.result.current.acquireNow();
	});
	return hook;
}

describe("I237 release without keeping the id", () => {
	it("an empty paused tab reconnects with a new session and no fallback notice", async () => {
		const o = options();
		const { result } = await readyTab(o);
		act(() => {
			result.current.release({ keepSessionId: false });
		});
		expect(result.current.state).toBe("released");
		expect(result.current.keptSessionId).toBeNull();
		await act(async () => {
			result.current.onSendClick("hi");
			await Promise.resolve();
		});
		expect(o.loadExistingSession).not.toHaveBeenCalled();
		expect(o.acquireNewSession).toHaveBeenCalledTimes(2);
		expect(result.current.sessionId).toBe("s2");
		expect(result.current.isFallbackRecovery).toBe(false);
	});

	it("a paused tab with history still loads its kept id", async () => {
		const o = options();
		const { result } = await readyTab(o);
		act(() => {
			result.current.release({ keepSessionId: true });
		});
		expect(result.current.keptSessionId).toBe("s1");
		await act(async () => {
			result.current.onSendClick("hi");
			await Promise.resolve();
		});
		expect(o.loadExistingSession).toHaveBeenCalledWith("s1");
	});
});
