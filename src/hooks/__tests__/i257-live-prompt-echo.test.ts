/**
 * I257 — reproduce-first: an agent that echoes the live prompt as
 * `user_message_chunk` must not change the user bubble.
 *
 * Probe (2026-11-06, `agy acp` 1.5.1): Antigravity echoes every block of the
 * prompt it receives, one `user_message_chunk` per block, verbatim and in
 * order, before any agent output and before the prompt response. Today
 * `applyReplayedUserChunk` joins the echo onto the local user text, so the
 * first bubble reads `hi<obsidian_system_instruction>…hi` and later ones
 * read `secondsecond`.
 *
 * Entry seam: the public hook API (sendMessage, enqueueUpdate,
 * discardPendingTurn, clearMessages). Only the ACP port (agentClient) is
 * faked; the real message-sender builds the prompt and runs the auth retry,
 * so the echo is exactly the content the plugin sends.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useAgentMessages } from "../useAgentMessages";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";
import type { IVaultAccess } from "../../services/vault-service";
import type { IMentionService } from "../../utils/mention-parser";
import type { ChatSession } from "../../types/session";
import type { ChatMessage, PromptContent } from "../../types/chat";

type Hook = ReturnType<typeof useAgentMessages>;

const vaultAccess = {
	readNote: async () => "note body",
	getAllFiles: () => [],
	getFileByPath: () => null,
} as unknown as IVaultAccess & IMentionService;

const SID = "s1";

interface Deferred {
	resolve: (v: { stopReason: string }) => void;
	reject: (e: unknown) => void;
}

/**
 * A fake agent. Each sendPrompt call records its content and, unless told
 * otherwise, echoes every text block back as a user_message_chunk the way
 * agy does. `mode` per call: "echo-resolve" (default), "echo-hold" (echo,
 * then never resolve until released), "echo-auth-fail" (echo, then reject
 * with -32000).
 */
function setup(opts: { authMethods?: { id: string; name: string }[] } = {}) {
	const holder: { hook: Hook | null } = { hook: null };
	const calls: PromptContent[][] = [];
	const held: Deferred[] = [];
	const modes: string[] = [];
	const echo = (content: PromptContent[], chunksPerBlock = 1) => {
		for (const b of content) {
			if (b.type !== "text") continue;
			const size = Math.ceil(b.text.length / chunksPerBlock);
			for (let i = 0; i < b.text.length; i += size) {
				holder.hook!.enqueueUpdate({
					type: "user_message_chunk",
					sessionId: SID,
					text: b.text.slice(i, i + size),
				});
			}
		}
	};
	let chunksPerBlock = 1;
	const sendPrompt = vi.fn(
		(_sid: string, content: PromptContent[]): Promise<{ stopReason: string }> => {
			calls.push(content);
			const mode = modes.shift() ?? "echo-resolve";
			echo(content, chunksPerBlock);
			if (mode === "echo-auth-fail") {
				return Promise.reject({ code: -32000, message: "Authentication required" });
			}
			if (mode === "echo-hold") {
				return new Promise((resolve, reject) => held.push({ resolve, reject }));
			}
			if (mode === "echo-reject") {
				return Promise.reject(new Error("boom"));
			}
			holder.hook!.enqueueUpdate({
				type: "agent_message_chunk",
				sessionId: SID,
				text: "Hello",
			});
			return Promise.resolve({ stopReason: "end_turn" });
		},
	);
	const authenticate = vi.fn(async () => true);
	const agentClient = { sendPrompt, authenticate } as unknown as AcpClient;
	const settingsAccess = {
		getSnapshot: () => ({
			titleStrategy: "agent-suggested",
			windowsWslMode: false,
		}),
	} as unknown as ISettingsAccess;
	const session = {
		sessionId: SID,
		authMethods: opts.authMethods ?? [],
		promptCapabilities: { embeddedContext: true, image: false, audio: false },
	} as unknown as ChatSession;
	const rendered = renderHook(() => {
		const h = useAgentMessages(agentClient, settingsAccess, vaultAccess, session, vi.fn());
		holder.hook = h;
		return h;
	});
	return {
		...rendered,
		calls,
		held,
		modes,
		sendPrompt,
		authenticate,
		setChunksPerBlock: (n: number) => {
			chunksPerBlock = n;
		},
	};
}

async function flushBatch() {
	await act(async () => {
		await new Promise((res) => requestAnimationFrame(() => res(null)));
		await new Promise((res) => setTimeout(res, 0));
	});
}

function text(m: ChatMessage): string {
	return m.content
		.map((b) => (b.type === "text" || b.type === "text_with_context" ? b.text : ""))
		.join("");
}

function users(msgs: ChatMessage[]): ChatMessage[] {
	return msgs.filter((m) => m.role === "user");
}

const first = { vaultBasePath: "/vault", contextNotes: [], isFirstMessage: true };
const later = { vaultBasePath: "/vault", contextNotes: [], isFirstMessage: false };

async function send(hook: { current: Hook }, words: string, options = later) {
	await act(async () => {
		await hook.current.sendMessage(words, options);
	});
	await flushBatch();
}

function replayChunk(hook: { current: Hook }, words: string) {
	act(() =>
		hook.current.enqueueUpdate({ type: "user_message_chunk", sessionId: SID, text: words }),
	);
}

describe("I257 — live prompt echo", () => {
	it("1. first message: the echo of the system instruction, rubric and words is dropped", async () => {
		const { result, calls } = setup();
		await send(result, "hi", first);

		// Precondition: the real sender put injected blocks in front of "hi".
		expect(calls[0].length).toBeGreaterThan(1);
		const msgs = result.current.messages;
		expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(text(msgs[0])).toBe("hi");
		expect(msgs[0].content).toHaveLength(1);
		expect(text(msgs[1])).toBe("Hello");
	});

	it("1b. first message with an auto-mentioned note: no echoed text block is added", async () => {
		const { result } = setup();
		await send(result, "hi", {
			vaultBasePath: "/vault",
			isFirstMessage: true,
			activeNote: { path: "n.md", name: "n", extension: "md" },
		} as unknown as typeof first);
		const bubble = users(result.current.messages)[0];
		expect(bubble.content).toHaveLength(1);
		expect(text(bubble)).toBe("hi");
	});

	it("2. later message: the echo doesn't duplicate the words", async () => {
		const { result } = setup();
		await send(result, "hi", first);
		await send(result, "second");
		const u = users(result.current.messages);
		expect(u.map(text)).toEqual(["hi", "second"]);
	});

	it("3a. a user chunk for another session during the turn is not dropped by the gate", async () => {
		const { result, modes, held } = setup();
		modes.push("echo-hold");
		act(() => {
			void result.current.sendMessage("hi", later);
		});
		await flushBatch();
		act(() =>
			result.current.enqueueUpdate({
				type: "user_message_chunk",
				sessionId: "other",
				text: "X",
			}),
		);
		await flushBatch();
		// Scoping only: the gate let the foreign chunk through.
		expect(text(users(result.current.messages)[0])).toBe("hiX");
		await act(async () => {
			held[0].resolve({ stopReason: "end_turn" });
		});
	});

	it("3b. one block echoed as several chunks: all dropped", async () => {
		const { result, setChunksPerBlock } = setup();
		setChunksPerBlock(3);
		await send(result, "hello there", first);
		expect(text(users(result.current.messages)[0])).toBe("hello there");
	});

	it("4. after the turn ends, a replay chunk is applied", async () => {
		const { result } = setup();
		await send(result, "hi");
		replayChunk(result, "!");
		await flushBatch();
		// Applied: the newest message is the reply, so it starts a new bubble.
		expect(users(result.current.messages).map(text)).toEqual(["hi", "!"]);
	});

	it("5. a failed send clears the gate", async () => {
		const { result, modes } = setup();
		modes.push("echo-reject");
		await send(result, "hi");
		expect(text(users(result.current.messages)[0])).toBe("hi");
		replayChunk(result, "!");
		await flushBatch();
		expect(text(users(result.current.messages)[0])).toBe("hi!");
	});

	it("6. auth retry: both echoes are dropped", async () => {
		const { result, modes, authenticate, sendPrompt } = setup({
			authMethods: [{ id: "oauth", name: "Log in" }],
		});
		modes.push("echo-auth-fail");
		await send(result, "hi", first);
		expect(authenticate).toHaveBeenCalledTimes(1);
		expect(sendPrompt).toHaveBeenCalledTimes(2);
		const u = users(result.current.messages);
		expect(u).toHaveLength(1);
		expect(text(u[0])).toBe("hi");
	});

	it("7. steer: an older turn settling late doesn't clear the newer gate; its late echo is dropped", async () => {
		const { result, modes, held } = setup();
		modes.push("echo-hold", "echo-hold");
		act(() => {
			void result.current.sendMessage("A", later);
		});
		await flushBatch();
		act(() => result.current.discardPendingTurn(20));
		// A's late echo inside the settle window: dropped by the I203 gate.
		replayChunk(result, "A");
		act(() => {
			void result.current.sendMessage("B", later);
		});
		await act(async () => {
			await new Promise((res) => setTimeout(res, 40));
		});
		await flushBatch();
		// A answers late, while B's gate is armed.
		await act(async () => {
			held[0].resolve({ stopReason: "cancelled" });
			await Promise.resolve();
		});
		replayChunk(result, "B");
		await flushBatch();
		expect(users(result.current.messages).map(text)).toEqual(["A", "B"]);
		await act(async () => {
			held[1].resolve({ stopReason: "end_turn" });
		});
	});

	it("8a. unsettled prompt + clearMessages: a later same-session chunk is applied", async () => {
		const { result, modes } = setup();
		modes.push("echo-hold");
		act(() => {
			void result.current.sendMessage("hi", later);
		});
		await flushBatch();
		act(() => result.current.clearMessages());
		replayChunk(result, "old words");
		await flushBatch();
		expect(users(result.current.messages).map(text)).toEqual(["old words"]);
	});

	it("8b. unsettled prompt + discardPendingTurn: dropped inside the window, applied after", async () => {
		const { result, modes } = setup();
		modes.push("echo-hold");
		act(() => {
			void result.current.sendMessage("hi", later);
		});
		await flushBatch();
		act(() => result.current.discardPendingTurn(20));
		replayChunk(result, "?");
		await flushBatch();
		expect(text(users(result.current.messages)[0])).toBe("hi");
		await act(async () => {
			await new Promise((res) => setTimeout(res, 40));
		});
		replayChunk(result, "!");
		await flushBatch();
		expect(text(users(result.current.messages)[0])).toBe("hi!");
	});
});
