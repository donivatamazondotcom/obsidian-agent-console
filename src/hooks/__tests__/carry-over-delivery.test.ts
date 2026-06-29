/**
 * Reproduce-first test for the Agent-Portable Sessions carry-over DELIVERY bug.
 *
 * [[Agent-Portable Sessions]] — cross-agent continuation works by stashing the
 * prior transcript as carry-over blocks on switch, then prepending them to the
 * first send to the NEW agent. The reported symptom: the target agent (Kiro
 * CLI) "received no prior conversation."
 *
 * The resume note ([[Resume - Agent-Portable Sessions carry-over bug]]) listed
 * three untested root-cause hypotheses:
 *   H1. sendPrompt drops some block types over the wire.
 *   H2. the carry-over is sent on the WRONG (old/stale) session.
 *   H3. block ordering causes the carry-over to be dropped.
 *
 * Reading the code disproved H1 (AcpClient.sendPrompt maps the FULL
 * PromptContent[] via toAcpContentBlock, which handles all four block types)
 * and made H3 implausible (carry-over is prepended at index 0). These tests
 * PIN that the in-plugin delivery chain is correct end-to-end, so the chain is
 * no longer a suspect:
 *
 *   1. useAgentMessages.sendMessage prepends carryOverBlocks to agentContent
 *      and forwards them to agentClient.sendPrompt — block FIRST, on the
 *      session id it was given (H1/H3 disproven; H2 holds for the delivered
 *      session — the lazy-acquire path's sessionId is covered separately by
 *      slice2-switch-recreate-lazy.test.ts).
 *   2. useChatActions.handleSendMessage passes the stashed carry-over to
 *      agent.sendMessage and consumes the ref EXACTLY ONCE — which also
 *      reproduces the optimistic-set edge: any send that fires between
 *      setCarryOverBlocks and the intended post-switch send steals the blocks,
 *      leaving the real target send empty (matches "received no prior
 *      conversation").
 *
 * These operate at the real-hook seam (renderHook), not a re-modeled sub-path,
 * per the TP-I05 reproduce-first lesson.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useAgentMessages, type SendMessageOptions } from "../useAgentMessages";
import { useChatActions } from "../useChatActions";
import { buildCarryOverBlocks } from "../../services/carry-over-builder";
import type { ChatMessage, PromptContent } from "../../types/chat";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeMessage(role: "user" | "assistant", text: string): ChatMessage {
	return {
		id: crypto.randomUUID(),
		role,
		content: [{ type: "text", text }],
		timestamp: new Date(),
	};
}

/** The carry-over the live switch path produces: a single XML text block
 *  (handleNewChatWithPersist always builds with embeddedContext=false because
 *  the TARGET agent's capabilities are unknown at switch time). */
function carryOverFixture(): PromptContent[] {
	return buildCarryOverBlocks(
		[makeMessage("user", "First question"), makeMessage("assistant", "First answer")],
		false,
	);
}

// ===========================================================================
// 1. Delivery to the wire — useAgentMessages (real hook)
// ===========================================================================

describe("Carry-over delivery — reaches agentClient.sendPrompt (H1/H3 reproduce-first)", () => {
	type AMParams = Parameters<typeof useAgentMessages>;

	function mount(sessionId: string) {
		const sendPrompt = vi.fn(
			async (_sessionId: string, _content: PromptContent[]): Promise<void> => {},
		);
		const agentClient = { sendPrompt } as unknown as AMParams[0];
		const settingsAccess = {
			getSnapshot: () => ({ titleStrategy: "off", windowsWslMode: false }),
		} as unknown as AMParams[1];
		// No mentions / no selection in these sends, so getAllFiles/readNote
		// are never invoked — a structural stub is enough.
		const vaultAccess = {
			getAllFiles: () => [],
			readNote: vi.fn(),
		} as unknown as AMParams[2];
		const session = {
			sessionId,
			promptCapabilities: { embeddedContext: false },
			authMethods: [],
		} as unknown as AMParams[3];
		const setErrorInfo = vi.fn();

		const { result } = renderHook(() =>
			useAgentMessages(agentClient, settingsAccess, vaultAccess, session, setErrorInfo),
		);
		return { result, sendPrompt };
	}

	it("prepends the carry-over block at index 0 and sends it on the GIVEN session", async () => {
		const { result, sendPrompt } = mount("kiro-new");
		const carry = carryOverFixture();

		await act(async () => {
			await result.current.sendMessage("hi", {
				vaultBasePath: "",
				contextNotes: [],
				carryOverBlocks: carry,
			});
		});

		expect(sendPrompt).toHaveBeenCalledTimes(1);
		const [sid, content] = sendPrompt.mock.calls[0];
		// H2: delivered on the new session id it was handed.
		expect(sid).toBe("kiro-new");
		// H3: carry-over is the FIRST block (prepended), not dropped/reordered.
		expect(content[0]).toEqual(carry[0]);
		// H1: the user's message still rides along after the carry-over.
		expect(content).toContainEqual({ type: "text", text: "hi" });
		// The carry-over text actually contains the prior transcript.
		const head = content[0] as { type: "text"; text: string };
		expect(head.text).toContain("<carry_over_transcript>");
		expect(head.text).toContain("User: First question");
	});

	it("baseline: without carry-over, the first block is the user message (no phantom prepend)", async () => {
		const { result, sendPrompt } = mount("kiro-new");

		await act(async () => {
			await result.current.sendMessage("hi", {
				vaultBasePath: "",
				contextNotes: [],
			});
		});

		expect(sendPrompt).toHaveBeenCalledTimes(1);
		const [, content] = sendPrompt.mock.calls[0];
		expect(content[0]).toEqual({ type: "text", text: "hi" });
	});
});

// ===========================================================================
// 2. Consume contract + optimistic-set edge — useChatActions (real hook)
// ===========================================================================

type CAParams = Parameters<typeof useChatActions>;

/** Recursive proxy so the hook's many dep-array reads don't throw; specific
 *  fields supplied via overrides. (Same pattern as useChatActions.test.ts.) */
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

function mountActions(sendMessage: ReturnType<typeof vi.fn>) {
	const plugin = deepMock({
		app: deepMock({
			metadataCache: deepMock({ getFirstLinkpathDest: () => null }),
		}),
	}) as CAParams[0];
	const agent = deepMock({ clearError: vi.fn(), sendMessage }) as CAParams[1];
	const sessionHistory = deepMock({ saveSessionLocally: vi.fn() }) as CAParams[2];
	const suggestions = deepMock() as CAParams[3];
	const session = { sessionId: "s1", agentId: "kiro-cli" } as unknown as CAParams[4];
	// No active-note default; keep contextNotes inert.
	const settings = { activeNoteAsDefaultContext: false } as unknown as CAParams[6];
	const contextNotes = { notes: [], add: vi.fn() } as unknown as CAParams[8];

	const { result } = renderHook(() =>
		useChatActions(
			plugin,
			agent,
			sessionHistory,
			suggestions,
			session,
			[],
			settings,
			"",
			contextNotes,
			null,
			null,
			false,
			{ current: null } as CAParams[12],
		),
	);
	return result;
}

describe("Carry-over consume contract — useChatActions.handleSendMessage", () => {
	it("passes stashed carry-over blocks to agent.sendMessage on the next send", async () => {
		const sendMessage = vi.fn(
			(_content: string, _options: SendMessageOptions) => Promise.resolve(),
		);
		const result = mountActions(sendMessage);
		const carry = carryOverFixture();

		act(() => result.current.setCarryOverBlocks(carry));

		await act(async () => {
			await result.current.handleSendMessage("hi");
		});

		expect(sendMessage).toHaveBeenCalledTimes(1);
		const opts = sendMessage.mock.calls[0][1];
		expect(opts.carryOverBlocks).toEqual(carry);
	});

	it("consumes the carry-over EXACTLY ONCE — an intervening send steals it (optimistic-set edge)", async () => {
		const sendMessage = vi.fn(
			(_content: string, _options: SendMessageOptions) => Promise.resolve(),
		);
		const result = mountActions(sendMessage);
		const carry = carryOverFixture();

		// Blocks are stashed optimistically (in handleNewChatWithPersist this
		// happens BEFORE the confirm modal opens). If a send fires before the
		// intended post-switch send, it consumes the ref...
		act(() => result.current.setCarryOverBlocks(carry));

		await act(async () => {
			await result.current.handleSendMessage("early send"); // e.g. send while modal open
		});
		await act(async () => {
			await result.current.handleSendMessage("intended post-switch send");
		});

		expect(sendMessage).toHaveBeenCalledTimes(2);
		const first = sendMessage.mock.calls[0][1];
		const second = sendMessage.mock.calls[1][1];
		// First send got the blocks...
		expect(first.carryOverBlocks).toEqual(carry);
		// ...and the intended send got NONE — reproduces "received no prior
		// conversation" when any send precedes the target send.
		expect(second.carryOverBlocks).toBeUndefined();
	});
});
