/**
 * I229 — `useLazySession.reloadNow`: soft reload runs as an acquisition
 * through the single lazy-session owner, so the tab goes
 * `ready → connecting → ready` and the queue's connect-flush edge fires.
 *
 * Seam: the public hook API with the real `useTabSessionState` machine; only
 * the acquisition callbacks (the ACP boundary) are faked (R2, R4). Assertions
 * are on the observable state and bound sessionId (R3).
 * Spec: [[I229 Send queued during soft reload never flushes]].
 */

import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
	useLazySession,
	type SessionAcquisitionResult,
	type UseLazySessionOptions,
} from "../useLazySession";

function makeOptions(
	overrides: Partial<UseLazySessionOptions> = {},
): UseLazySessionOptions {
	return {
		acquireNewSession: vi
			.fn()
			.mockResolvedValue({ ok: true, sessionId: "s1" }),
		loadExistingSession: vi
			.fn()
			.mockResolvedValue({ ok: true, sessionId: "loaded" }),
		sendPrompt: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

/** A run whose outcome the test controls by hand. */
function deferredRun() {
	let resolve: (r: SessionAcquisitionResult) => void = () => {};
	const promise = new Promise<SessionAcquisitionResult>((r) => {
		resolve = r;
	});
	const run = vi.fn(() => promise);
	return { run, resolve };
}

async function mountReady(options = makeOptions()) {
	const hook = renderHook(() => useLazySession(options));
	await act(async () => {
		await hook.result.current.acquireNow();
	});
	expect(hook.result.current.state).toBe("ready");
	expect(hook.result.current.sessionId).toBe("s1");
	return hook;
}

describe("useLazySession.reloadNow (I229)", () => {
	it("goes ready → connecting → ready and keeps the resumed id", async () => {
		const { result } = await mountReady();
		const { run, resolve } = deferredRun();

		let done: Promise<void> = Promise.resolve();
		act(() => {
			done = result.current.reloadNow(run);
		});
		expect(result.current.state).toBe("connecting");
		expect(run).toHaveBeenCalledTimes(1);

		await act(async () => {
			resolve({ ok: true, sessionId: "s1" });
			await done;
		});
		expect(result.current.state).toBe("ready");
		expect(result.current.sessionId).toBe("s1");
	});

	it("binds the replacement id when the reload fell back to a new session", async () => {
		const { result } = await mountReady();
		await act(async () => {
			await result.current.reloadNow(async () => ({
				ok: true,
				sessionId: "s2",
			}));
		});
		expect(result.current.state).toBe("ready");
		expect(result.current.sessionId).toBe("s2");
	});

	it("a failed reload ends in error", async () => {
		const { result } = await mountReady();
		await act(async () => {
			await result.current.reloadNow(async () => ({
				ok: false,
				error: new Error("no session"),
			}));
		});
		expect(result.current.state).toBe("error");
	});

	it("a run that throws ends in error (not stuck in connecting) and rethrows to the caller", async () => {
		const { result } = await mountReady();
		let thrown: unknown;
		await act(async () => {
			try {
				await result.current.reloadNow(async () => {
					throw new Error("disconnect failed");
				});
			} catch (e) {
				thrown = e;
			}
		});
		expect((thrown as Error).message).toBe("disconnect failed");
		expect(result.current.state).toBe("error");
	});

	it("does nothing when no session is bound", async () => {
		const { result } = renderHook(() => useLazySession(makeOptions()));
		const run = vi.fn(async () => ({ ok: true as const, sessionId: "x" }));
		await act(async () => {
			await result.current.reloadNow(run);
		});
		expect(run).not.toHaveBeenCalled();
		expect(result.current.state).toBe("idle");
	});

	it("does nothing while another acquisition or reload is in flight", async () => {
		const { result } = await mountReady();
		const first = deferredRun();
		const second = vi.fn(async () => ({ ok: true as const, sessionId: "s9" }));

		let done: Promise<void> = Promise.resolve();
		act(() => {
			done = result.current.reloadNow(first.run);
		});
		await act(async () => {
			await result.current.reloadNow(second);
		});
		expect(second).not.toHaveBeenCalled();

		await act(async () => {
			first.resolve({ ok: true, sessionId: "s1" });
			await done;
		});
		expect(result.current.sessionId).toBe("s1");
	});

	it("a reset during the reload discards the reload's result (I175 guard)", async () => {
		const { result } = await mountReady();
		const { run, resolve } = deferredRun();

		let done: Promise<void> = Promise.resolve();
		act(() => {
			done = result.current.reloadNow(run);
		});
		act(() => {
			result.current.reset();
		});
		await act(async () => {
			resolve({ ok: true, sessionId: "s1" });
			await done;
		});
		expect(result.current.state).toBe("idle");
		expect(result.current.sessionId).toBeNull();
	});
});
