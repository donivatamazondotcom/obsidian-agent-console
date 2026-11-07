/**
 * I292 — a restored tab that hasn't woken shows the moon, not the ready dot.
 *
 * After a restart, restored tabs stay in the lazy `idle` lifecycle until you
 * type, holding the restored session id in `keptSessionId`. The tab icon must
 * read that as asleep (`released`), like a tab released after an hour idle.
 * A fresh tab still reads `ready`, and typing still wakes the restored tab.
 *
 * Seam: the public `useLazySession` API with the real `useTabSessionState`
 * machine, composed with the production `deriveTabState` exactly as ChatPanel
 * does (`hasHeldSession: keptSessionId !== null`) (R2). Only the acquisition
 * callbacks (the ACP boundary) are faked (R4). Expected values are literals
 * (R5).
 *
 * Spec: [[I292 Restored tabs that haven't woken show the ready dot, not the moon]].
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
	useLazySession,
	type UseLazySessionOptions,
} from "../useLazySession";
import { deriveTabState } from "../../resolvers/tab-state";
import type { TabState } from "../../types/tab";

function makeOptions(
	overrides: Partial<UseLazySessionOptions> = {},
): UseLazySessionOptions {
	return {
		acquireNewSession: vi
			.fn()
			.mockResolvedValue({ ok: true, sessionId: "fresh" }),
		loadExistingSession: vi
			.fn()
			.mockImplementation(async (id: string) => ({ ok: true, sessionId: id })),
		sendPrompt: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

/** The tab icon for the hook's current output, wired as ChatPanel wires it. */
function iconFor(lazy: ReturnType<typeof useLazySession>): TabState {
	return deriveTabState({
		lifecycle: lazy.state,
		isSending: false,
		hasActivePermission: false,
		unseen: null,
		hasHeldSession: lazy.keptSessionId !== null,
	});
}

describe("I292 restored tab icon", () => {
	it("a restored tab that hasn't woken shows the moon", () => {
		const { result } = renderHook(() =>
			useLazySession(makeOptions({ restoredSessionId: "restored-1" })),
		);
		expect(result.current.state).toBe("idle");
		expect(iconFor(result.current)).toBe("released");
	});

	it("a fresh tab with no session shows ready", () => {
		const { result } = renderHook(() => useLazySession(makeOptions()));
		expect(result.current.state).toBe("idle");
		expect(iconFor(result.current)).toBe("ready");
	});

	it("New chat on a restored tab forgets the id and shows ready", () => {
		const { result } = renderHook(() =>
			useLazySession(makeOptions({ restoredSessionId: "restored-1" })),
		);
		act(() => result.current.reset());
		expect(iconFor(result.current)).toBe("ready");
	});

	it("typing in a restored tab wakes it in the same session", async () => {
		vi.useFakeTimers();
		try {
			let resolveLoad: (v: { ok: true; sessionId: string }) => void = () => {};
			const options = makeOptions({
				restoredSessionId: "restored-1",
				loadExistingSession: vi.fn(
					() =>
						new Promise<{ ok: true; sessionId: string }>((r) => {
							resolveLoad = r;
						}),
				),
			});
			const { result } = renderHook(() => useLazySession(options));
			act(() => result.current.onComposerChange("h"));
			act(() => {
				vi.advanceTimersByTime(200);
			});
			expect(iconFor(result.current)).toBe("connecting");
			await act(async () => {
				resolveLoad({ ok: true, sessionId: "restored-1" });
				await Promise.resolve();
			});
			expect(options.loadExistingSession).toHaveBeenCalledWith("restored-1");
			expect(options.acquireNewSession).not.toHaveBeenCalled();
			expect(result.current.state).toBe("ready");
			expect(result.current.sessionId).toBe("restored-1");
			expect(iconFor(result.current)).toBe("ready");
		} finally {
			vi.useRealTimers();
		}
	});
});
