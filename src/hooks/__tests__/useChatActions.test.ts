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
	return new Proxy(function () {}, {
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
				null,
				false,
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

describe("useChatActions handleSendMessage — auto-default crystallize on first send (I68, Decision #26)", () => {
	function setup(opts: {
		messages: ChatMessage[];
		activeNoteAsDefaultContext: boolean;
		activeNotePath: string | null;
		autoDefaultSuppressed: boolean;
	}) {
		const add = vi.fn();
		const sendMessage = vi.fn(() => new Promise<void>(() => {}));
		const plugin = deepMock({
			app: deepMock({
				metadataCache: deepMock({ getFirstLinkpathDest: () => null }),
			}),
		}) as Params[0];
		const agent = deepMock({ clearError: vi.fn(), sendMessage }) as Params[1];
		const sessionHistory = deepMock({
			saveSessionLocally: vi.fn(),
		}) as Params[2];
		const suggestions = deepMock() as Params[3];
		const session = { sessionId: "s1" } as unknown as Params[4];
		const settings = {
			activeNoteAsDefaultContext: opts.activeNoteAsDefaultContext,
		} as unknown as Params[6];
		const contextNotes = { notes: [], add } as unknown as Params[8];

		const { result } = renderHook(() =>
			useChatActions(
				plugin,
				agent,
				sessionHistory,
				suggestions,
				session,
				opts.messages,
				settings,
				"",
				contextNotes,
				null,
				opts.activeNotePath,
				opts.autoDefaultSuppressed,
			),
		);
		return { add, result };
	}

	async function send(result: ReturnType<typeof setup>["result"]) {
		await act(async () => {
			void result.current.handleSendMessage("hi");
			await Promise.resolve();
		});
	}

	it("crystallizes the active note as auto-default on first send", async () => {
		const { add, result } = setup({
			messages: [],
			activeNoteAsDefaultContext: true,
			activeNotePath: "B.md",
			autoDefaultSuppressed: false,
		});
		await send(result);
		expect(add).toHaveBeenCalledWith("B.md", "auto-default");
	});

	it("does not auto-default on a non-first message", async () => {
		const { add, result } = setup({
			messages: [existingMsg()],
			activeNoteAsDefaultContext: true,
			activeNotePath: "B.md",
			autoDefaultSuppressed: false,
		});
		await send(result);
		expect(add).not.toHaveBeenCalledWith("B.md", "auto-default");
	});

	it("does not auto-default when suppressed", async () => {
		const { add, result } = setup({
			messages: [],
			activeNoteAsDefaultContext: true,
			activeNotePath: "B.md",
			autoDefaultSuppressed: true,
		});
		await send(result);
		expect(add).not.toHaveBeenCalledWith("B.md", "auto-default");
	});

	it("does not auto-default when the setting is off", async () => {
		const { add, result } = setup({
			messages: [],
			activeNoteAsDefaultContext: false,
			activeNotePath: "B.md",
			autoDefaultSuppressed: false,
		});
		await send(result);
		expect(add).not.toHaveBeenCalledWith("B.md", "auto-default");
	});
});

describe("useChatActions handleSendMessage — auto-default reaches the send payload (I73)", () => {
	it("includes the auto-default note in the contextNotes sent to the agent on first send", async () => {
		const add = vi.fn();
		const sendMessage = vi.fn(() => new Promise<void>(() => {}));
		const plugin = deepMock({
			app: deepMock({
				metadataCache: deepMock({ getFirstLinkpathDest: () => null }),
			}),
		}) as Params[0];
		const agent = deepMock({ clearError: vi.fn(), sendMessage }) as Params[1];
		const sessionHistory = deepMock({ saveSessionLocally: vi.fn() }) as Params[2];
		const suggestions = deepMock() as Params[3];
		const session = { sessionId: "s1" } as unknown as Params[4];
		const settings = { activeNoteAsDefaultContext: true } as unknown as Params[6];
		// New-session semantics: notes empty when the callback is created; add()
		// does NOT mutate .notes synchronously (mirrors React setState). This is the
		// stale read that drops the just-crystallized note from the first send.
		const contextNotes = { notes: [], add } as unknown as Params[8];

		const { result } = renderHook(() =>
			useChatActions(
				plugin, agent, sessionHistory, suggestions, session,
				[], settings, "", contextNotes, null, "B.md", false,
			),
		);

		await act(async () => {
			void result.current.handleSendMessage("hi");
			await Promise.resolve();
		});

		expect(sendMessage).toHaveBeenCalledTimes(1);
		const payload = (sendMessage.mock.calls[0] as unknown[])[1] as {
			contextNotes?: Array<{ path: string; source: string }>;
		};
		expect(payload.contextNotes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "B.md", source: "auto-default" }),
			]),
		);
	});
});
