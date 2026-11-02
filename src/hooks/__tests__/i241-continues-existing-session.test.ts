/**
 * I241 — the two halves of the "first message" decision.
 *
 * 1. `isFirstMessageOfSession` truth table (pure resolver).
 * 2. `useLazySession.continuesExistingSession`, the owner's answer: true for a
 *    restored id that is pending or loaded, false after a failed load falls
 *    back to a new session, and false after reset (New chat).
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { isFirstMessageOfSession } from "../../resolvers/first-message";
import { useLazySession } from "../useLazySession";

describe("isFirstMessageOfSession", () => {
	it.each([
		[0, false, true],
		[0, true, false],
		[3, false, false],
		[3, true, false],
	])("transcript %i, continues %s → %s", (transcriptLength, continuesExistingSession, expected) => {
		expect(isFirstMessageOfSession({ transcriptLength, continuesExistingSession })).toBe(expected);
	});
});

function render(restoredSessionId: string | null, loadOk: boolean) {
	return renderHook(() =>
		useLazySession({
			restoredSessionId,
			acquireNewSession: vi.fn(async () => ({ ok: true as const, sessionId: "fresh-1" })),
			loadExistingSession: vi.fn(async (id: string) =>
				loadOk
					? { ok: true as const, sessionId: id }
					: { ok: false as const, error: new Error("gone") },
			),
			sendPrompt: vi.fn(async () => {}),
			debounceMs: 0,
		}),
	);
}

describe("useLazySession.continuesExistingSession", () => {
	it("a fresh tab does not continue a session", () => {
		const { result } = render(null, true);
		expect(result.current.continuesExistingSession()).toBe(false);
	});

	it("a restored tab continues its session before and after a successful load", async () => {
		const { result } = render("sess_1", true);
		expect(result.current.continuesExistingSession()).toBe(true);
		await act(async () => {
			result.current.onSendClick("hi");
			await new Promise((r) => setTimeout(r, 0));
		});
		expect(result.current.sessionId).toBe("sess_1");
		expect(result.current.continuesExistingSession()).toBe(true);
	});

	it("a failed load that falls back to a new session is a fresh session", async () => {
		const { result } = render("sess_1", false);
		await act(async () => {
			result.current.onSendClick("hi");
			await new Promise((r) => setTimeout(r, 0));
		});
		expect(result.current.sessionId).toBe("fresh-1");
		expect(result.current.continuesExistingSession()).toBe(false);
	});

	it("reset (New chat) ends the continuation", () => {
		const { result } = render("sess_1", true);
		act(() => result.current.reset());
		expect(result.current.continuesExistingSession()).toBe(false);
	});
});
