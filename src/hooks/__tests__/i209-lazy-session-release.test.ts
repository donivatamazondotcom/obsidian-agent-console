/**
 * I209 — `useLazySession.release()` (spec § 2, § 6 tests 3 and 5).
 *
 * Release keeps the session id: it moves into the restored-id slot, the live
 * id clears, and the next acquisition takes the existing restored-id branch
 * (`loadExistingSession(id)`), never `session/new`. `reset()` after release
 * still discards the id. Release is rejected unless the tab is `ready` and no
 * acquisition is in flight.
 *
 * Seam: the public hook API with the real `useTabSessionState` machine; only
 * the acquisition callbacks (the ACP boundary) are faked (R2, R4). The
 * restart test composes the hook with the production `resolveSessionIdForSave`
 * exactly as ChatPanel does (R2). Expected values are literals (R5).
 *
 * Spec: [[I209 Idle tabs never release their agent process]].
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
	useLazySession,
	type SessionAcquisitionResult,
	type UseLazySessionOptions,
} from "../useLazySession";
import { resolveSessionIdForSave } from "../../services/session-helpers";

function makeOptions(
	overrides: Partial<UseLazySessionOptions> = {},
): UseLazySessionOptions {
	return {
		acquireNewSession: vi
			.fn()
			.mockResolvedValue({ ok: true, sessionId: "s1" }),
		loadExistingSession: vi
			.fn()
			.mockImplementation(async (id: string) => ({ ok: true, sessionId: id })),
		sendPrompt: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

async function mountReady(options = makeOptions()) {
	const hook = renderHook((props: UseLazySessionOptions) => useLazySession(props), {
		initialProps: options,
	});
	await act(async () => {
		await hook.result.current.acquireNow();
	});
	expect(hook.result.current.state).toBe("ready");
	expect(hook.result.current.sessionId).toBe("s1");
	return hook;
}

describe("I209 useLazySession.release", () => {
	it("goes ready → released, clears the live id, keeps the id", async () => {
		const { result } = await mountReady();
		let released = false;
		act(() => {
			released = result.current.release();
		});
		expect(released).toBe(true);
		expect(result.current.state).toBe("released");
		expect(result.current.sessionId).toBeNull();
		expect(result.current.keptSessionId).toBe("s1");
	});

	it("a send after release loads the kept id, not a new session", async () => {
		const options = makeOptions();
		const { result } = await mountReady(options);
		act(() => {
			result.current.release();
		});
		await act(async () => {
			result.current.onSendClick("hello");
			await Promise.resolve();
		});
		expect(options.loadExistingSession).toHaveBeenCalledWith("s1");
		expect(options.acquireNewSession).toHaveBeenCalledTimes(1); // mount only
		expect(result.current.state).toBe("ready");
		expect(result.current.sessionId).toBe("s1");
		expect(result.current.isFallbackRecovery).toBe(false);
	});

	it("typing after release reconnects through the kept id", async () => {
		vi.useFakeTimers();
		try {
			const options = makeOptions();
			const { result } = await mountReady(options);
			act(() => {
				result.current.release();
			});
			act(() => result.current.onComposerChange("h"));
			expect(result.current.isAcquisitionPending()).toBe(true);
			await act(async () => {
				vi.advanceTimersByTime(200);
				await Promise.resolve();
			});
			expect(options.loadExistingSession).toHaveBeenCalledWith("s1");
			expect(result.current.state).toBe("ready");
		} finally {
			vi.useRealTimers();
		}
	});

	it("reset after release discards the id; the next send is new", async () => {
		const options = makeOptions();
		const { result } = await mountReady(options);
		act(() => {
			result.current.release();
		});
		act(() => result.current.reset());
		expect(result.current.state).toBe("idle");
		expect(result.current.keptSessionId).toBeNull();
		await act(async () => {
			result.current.onSendClick("hello");
			await Promise.resolve();
		});
		expect(options.loadExistingSession).not.toHaveBeenCalled();
		expect(options.acquireNewSession).toHaveBeenCalledTimes(2);
	});

	it("release during an acquisition is rejected", async () => {
		let resolve: (r: SessionAcquisitionResult) => void = () => {};
		const options = makeOptions({
			acquireNewSession: vi.fn(
				() =>
					new Promise<SessionAcquisitionResult>((r) => {
						resolve = r;
					}),
			),
		});
		const { result } = renderHook(() => useLazySession(options));
		let done: Promise<void> = Promise.resolve();
		act(() => {
			done = result.current.acquireNow();
		});
		expect(result.current.state).toBe("connecting");
		expect(result.current.isAcquisitionPending()).toBe(true);
		let released = true;
		act(() => {
			released = result.current.release();
		});
		expect(released).toBe(false);
		expect(result.current.state).toBe("connecting");
		await act(async () => {
			resolve({ ok: true, sessionId: "s1" });
			await done;
		});
		expect(result.current.state).toBe("ready");
		expect(result.current.sessionId).toBe("s1");
		expect(result.current.isAcquisitionPending()).toBe(false);
	});

	it("release is rejected while busy and keeps the live id", async () => {
		const { result } = await mountReady();
		act(() => result.current.startBusy());
		let released = true;
		act(() => {
			released = result.current.release();
		});
		expect(released).toBe(false);
		expect(result.current.state).toBe("busy");
		expect(result.current.sessionId).toBe("s1");
	});

	it("release is rejected with no bound session", () => {
		const { result } = renderHook(() => useLazySession(makeOptions()));
		let released = true;
		act(() => {
			released = result.current.release();
		});
		expect(released).toBe(false);
		expect(result.current.state).toBe("idle");
	});

	it("a pending typing debounce counts as acquisition pending", () => {
		vi.useFakeTimers();
		try {
			const { result } = renderHook(() =>
				useLazySession(makeOptions({ restoredSessionId: "r1" })),
			);
			expect(result.current.isAcquisitionPending()).toBe(false);
			act(() => result.current.onComposerChange("x"));
			expect(result.current.isAcquisitionPending()).toBe(true);
			act(() => result.current.onComposerChange(""));
			expect(result.current.isAcquisitionPending()).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("I209 released id survives a restart (mount → persist → remount)", () => {
	it("a fresh tab that released persists and restores the released id", async () => {
		// Run 1: fresh tab (no restored id), sends, then releases.
		const first = await mountReady();
		act(() => {
			first.result.current.release();
		});
		// ChatPanel's save: live agent id is null after release; the kept id
		// stands in for the mount snapshot (which is null for a fresh tab).
		const persisted = resolveSessionIdForSave(
			null,
			first.result.current.keptSessionId,
			true,
		);
		expect(persisted).toBe("s1");
		first.unmount();

		// Run 2: remount with the persisted id, as a restored tab.
		const options = makeOptions({ restoredSessionId: persisted });
		const second = renderHook(() => useLazySession(options));
		expect(second.result.current.keptSessionId).toBe("s1");
		await act(async () => {
			second.result.current.onSendClick("back again");
			await Promise.resolve();
		});
		expect(options.loadExistingSession).toHaveBeenCalledWith("s1");
		expect(options.acquireNewSession).not.toHaveBeenCalled();
		expect(second.result.current.sessionId).toBe("s1");
	});

	it("a fresh eager tab with no messages still stays unpersisted", async () => {
		const { result } = await mountReady();
		// Live id bound, nothing kept, no messages yet → nothing to persist.
		expect(
			resolveSessionIdForSave(
				result.current.sessionId,
				result.current.keptSessionId,
				false,
			),
		).toBeNull();
	});
});

describe("I209 × I229: reload on a released tab", () => {
	it("reconnects on the kept id instead of doing nothing", async () => {
		const options = makeOptions();
		const { result } = await mountReady(options);
		act(() => {
			result.current.release();
		});
		// The soft-reload run (tear down, re-init, resume) must NOT run: there
		// is no process to tear down. The reconnect is the fresh harness.
		const run = vi.fn(async (): Promise<SessionAcquisitionResult> => ({
			ok: true,
			sessionId: "should-not-bind",
		}));
		await act(async () => {
			await result.current.reloadNow(run);
		});
		expect(run).not.toHaveBeenCalled();
		expect(options.loadExistingSession).toHaveBeenCalledWith("s1");
		expect(result.current.state).toBe("ready");
		expect(result.current.sessionId).toBe("s1");
	});

	it("a plain idle tab with no session still ignores reload", async () => {
		const options = makeOptions();
		const { result } = renderHook(() => useLazySession(options));
		const run = vi.fn();
		await act(async () => {
			await result.current.reloadNow(run);
		});
		expect(run).not.toHaveBeenCalled();
		expect(options.loadExistingSession).not.toHaveBeenCalled();
		expect(options.acquireNewSession).not.toHaveBeenCalled();
		expect(result.current.state).toBe("idle");
	});
});
