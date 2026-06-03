/**
 * T10 mention-crystallize timing (I66).
 *
 * handleSendMessage crystallized @[[mentions]] into pills AFTER
 * `await agent.sendMessage(...)`, which only resolves when the whole turn
 * completes — so pills appeared after the turn ended, not on send. This test
 * pins the fix: the pill is added at send time, while the turn is still
 * in-flight. Red against the post-await ordering.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatActions } from "../useChatActions";
import type { ChatMessage } from "../../types/chat";

type Params = Parameters<typeof useChatActions>;

/** Recursive proxy: any property access returns a callable mock, so the
 *  hook's many dep-array reads (agent.*, suggestions.mentions.*, etc.) don't
 *  throw. Specific fields are supplied via `overrides`. */
function deepMock(overrides: Record<string, unknown> = {}): unknown {
	const cache: Record<string, unknown> = { ...overrides };
	return new Proxy(function () {} as unknown as object, {
		get(_t, p: string | symbol) {
			if (typeof p === "symbol") return undefined;
			if (!(p in cache)) cache[p] = deepMock();
			return cache[p];
		},
		apply: () => undefined,
	});
}

function existingMsg(): ChatMessage {
	return {
		id: "m1",
		role: "user",
		content: [{ type: "text", text: "hi" }],
		timestamp: new Date(),
	};
}

describe("useChatActions handleSendMessage — mention crystallize timing (I66)", () => {
	it("crystallizes @[[mentions]] on send, before the turn completes", async () => {
		const add = vi.fn();
		// Turn stays in-flight: sendMessage never resolves.
		const sendMessage = vi.fn(() => new Promise<void>(() => {}));

		const plugin = deepMock({
			app: deepMock({
				metadataCache: deepMock({
					getFirstLinkpathDest: () => ({ path: "Foo.md" }),
				}),
			}),
		}) as Params[0];
		const agent = deepMock({ clearError: vi.fn(), sendMessage }) as Params[1];
		const sessionHistory = deepMock({
			saveSessionLocally: vi.fn(),
		}) as Params[2];
		const suggestions = deepMock() as Params[3];
		const session = { sessionId: "s1" } as unknown as Params[4];
		const settings = deepMock() as Params[6];
		const contextNotes = { notes: [], add } as unknown as Params[8];

		const { result } = renderHook(() =>
			useChatActions(
				plugin,
				agent,
				sessionHistory,
				suggestions,
				session,
				[existingMsg()],
				settings,
				"",
				contextNotes,
				null,
			),
		);

		await act(async () => {
			void result.current.handleSendMessage("@[[Foo]] hi");
			await Promise.resolve();
		});

		// The turn has NOT resolved, yet the pill must already be crystallized.
		expect(sendMessage).toHaveBeenCalledTimes(1);
		expect(add).toHaveBeenCalledWith("Foo.md", "mention");
	});
});
