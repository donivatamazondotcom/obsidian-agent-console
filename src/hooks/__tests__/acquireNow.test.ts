import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLazySession } from "../useLazySession";

/**
 * Slice 3 — useLazySession.acquireNow: explicit eager acquisition through the
 * single session/new owner. Backs Restart agent / hard reload (design D3): the
 * agent comes back without the user typing, but createSession still flows
 * exclusively through useLazySession.
 */
function makeOptions(overrides: Record<string, unknown> = {}) {
	let n = 0;
	return {
		acquireNewSession: vi.fn(async () => {
			n += 1;
			return { ok: true as const, sessionId: `sess-${n}` };
		}),
		loadExistingSession: vi.fn(async () => ({
			ok: true as const,
			sessionId: "loaded",
		})),
		sendPrompt: vi.fn(async () => {}),
		debounceMs: 0,
		...overrides,
	};
}

describe("useLazySession.acquireNow", () => {
	it("acquires a fresh session immediately from idle (no keystroke)", async () => {
		const options = makeOptions();
		const { result } = renderHook(() => useLazySession(options));

		expect(result.current.state).toBe("idle");
		await act(async () => {
			await result.current.acquireNow();
		});

		expect(options.acquireNewSession).toHaveBeenCalledTimes(1);
		expect(result.current.state).toBe("ready");
		expect(result.current.sessionId).toBe("sess-1");
	});

	it("resets an existing session, then re-acquires a fresh one (restart/hard-reload)", async () => {
		const options = makeOptions();
		const { result } = renderHook(() => useLazySession(options));

		// First acquisition via typing.
		act(() => result.current.onComposerChange("hi"));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 5));
		});
		expect(result.current.sessionId).toBe("sess-1");

		// acquireNow tears down the old session and acquires a fresh one.
		await act(async () => {
			await result.current.acquireNow();
		});
		expect(options.acquireNewSession).toHaveBeenCalledTimes(2);
		expect(result.current.sessionId).toBe("sess-2");
		expect(result.current.state).toBe("ready");
	});

	it("forgets a restored sessionId — acquireNow always creates fresh (never loads)", async () => {
		const options = makeOptions({ restoredSessionId: "restored-1" });
		const { result } = renderHook(() => useLazySession(options));

		await act(async () => {
			await result.current.acquireNow();
		});

		// Goes straight to acquireNewSession, NOT loadExistingSession.
		expect(options.loadExistingSession).not.toHaveBeenCalled();
		expect(options.acquireNewSession).toHaveBeenCalledTimes(1);
		expect(result.current.sessionId).toBe("sess-1");
	});
});
