/**
 * I241 — reproduce-first: the first send on a tab that continues an existing
 * session (restored from history, no local copy) is NOT a first message.
 *
 * Bug: `handleSendMessage` decided `isFirstMessage = messages.length === 0`.
 * A restored agent-only tab loads lazily on that very send, so the transcript
 * is still empty and the prompt went out with the system instruction and the
 * title rubric again. In the I222 smoke the agent answered the rubric with a
 * `<title>`, and the AI title then replaced the agent's title (I223 undone).
 *
 * Fix contract: the decision goes through `isFirstMessageOfSession`, which
 * also asks the lazy-session owner whether the tab continues an existing
 * session. Entry seam: the public hook API; the agent facade is a mock
 * (architecture boundary for this hook).
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatActions } from "../useChatActions";

type Params = Parameters<typeof useChatActions>;

function deepMock(overrides: Record<string, unknown> = {}): unknown {
	const cache: Record<string, unknown> = { ...overrides };
	return new Proxy(function () {}, {
		get(_t, p: string | symbol) {
			if (typeof p === "symbol") return undefined;
			if (!(p in cache)) cache[p] = deepMock();
			return cache[p];
		},
		apply: () => undefined,
	});
}

function firstSendFlag(continuesExistingSession: boolean): boolean | undefined {
	const sendMessage = vi.fn(() => new Promise<void>(() => {}));
	const plugin = deepMock({
		app: deepMock({ metadataCache: deepMock({ getFirstLinkpathDest: () => null }) }),
	}) as Params[0];
	const agent = deepMock({ clearError: vi.fn(), sendMessage }) as Params[1];
	const sessionHistory = deepMock({ saveSessionLocally: vi.fn() }) as Params[2];
	const contextNotes = { notes: [], add: vi.fn() } as unknown as Params[8];
	const args = [
		plugin,
		agent,
		sessionHistory,
		deepMock() as Params[3],
		{ sessionId: "s1" } as unknown as Params[4],
		[], // empty transcript: the replay has not arrived yet
		deepMock() as Params[6],
		"/vault",
		contextNotes,
		null,
		null,
		false,
		{ current: null } as Params[12],
		"/vault",
		"/vault",
		{ current: null },
		{ current: () => continuesExistingSession },
	] as unknown as Params;
	const { result } = renderHook(() => useChatActions(...args));
	void act(() => {
		void result.current.handleSendMessage("hi");
	});
	expect(sendMessage).toHaveBeenCalledTimes(1);
	return ((sendMessage.mock.calls[0] as unknown[])[1] as { isFirstMessage?: boolean })
		.isFirstMessage;
}

describe("I241 — first send on a restored tab", () => {
	it("a tab continuing an existing session sends without first-message extras", () => {
		expect(firstSendFlag(true)).toBe(false);
	});

	it("a fresh tab's first send is still a first message", () => {
		expect(firstSendFlag(false)).toBe(true);
	});
});
