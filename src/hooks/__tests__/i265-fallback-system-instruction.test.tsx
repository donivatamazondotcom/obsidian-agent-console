/**
 * I265 — a fresh agent session after a fallback gets the system instruction.
 *
 * After any lossy fallback (failed load, engine change, empty load, soft
 * reload fresh, local fork) the transcript is still on screen, but the agent
 * session is new. Its first send must carry `<obsidian_system_instruction>`,
 * then the transcript (I246), then the user's text, and nothing that belongs
 * to the first message of a CHAT (title rubric, first-message history save).
 *
 * Driven as ChatPanel wires it: the real `useLazySession` owner, the real
 * `useChatActions` (with the I241 `continuesExistingSession` ref wired) and the
 * real `useAgentMessages`, which builds the prompt the agent receives. Only the
 * ACP port and the settings / vault ports are faked.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useLazySession } from "../useLazySession";
import {
	reconnectExistingSession,
	type ReconnectClientPort,
} from "../loadExistingSessionFlow";
import { reloadResultToAcquisition } from "../reloadSessionFlow";
import { useChatActions } from "../useChatActions";
import { useAgentMessages } from "../useAgentMessages";
import { stripInjectedPromptText } from "../../services/message-sender";
import { NO_AGENT_CAPABILITIES, type SessionResult } from "../../types/session";
import type { ChatMessage, PromptContent } from "../../types/chat";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function msg(role: "user" | "assistant", text: string, id: string): ChatMessage {
	return {
		id,
		role,
		content: [{ type: "text", text }],
		timestamp: new Date("2026-11-02T10:00:00Z"),
	};
}

const REMEMBER_7: ChatMessage[] = [
	msg("user", "Remember the number 7.", "u1"),
	msg("assistant", "Got it, I will remember 7.", "a1"),
];

const INSTRUCTION = "<obsidian_system_instruction>";
const TRANSCRIPT = "<carry_over_transcript>";
const RUBRIC_MARK = "<title>";

function textOf(block: PromptContent | undefined): string {
	if (!block) return "";
	if (block.type === "text") return block.text;
	if (block.type === "resource") return block.resource.text ?? "";
	return "";
}

type CAParams = Parameters<typeof useChatActions>;
type AMParams = Parameters<typeof useAgentMessages>;

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

/** ACP port: `known` ids load with a replay; others fail (V2) or load empty (V3, I264). */
function fakeClient(engine: "v2" | "v3", known: string[], emptyLoad: boolean) {
	let initialized = false;
	const client: ReconnectClientPort = {
		isInitialized: () => initialized,
		getInitializeResult: () =>
			initialized
				? {
						capabilities: { ...NO_AGENT_CAPABILITIES, restoresViaLoad: true },
						kiroEngine: engine,
					}
				: null,
		loadSession: vi.fn(async (sid: string): Promise<SessionResult> => {
			if (known.includes(sid)) {
				return { sessionId: sid, replayedConversationUpdates: 2 };
			}
			if (emptyLoad) return { sessionId: sid, replayedConversationUpdates: 0 };
			throw new Error("Session not found");
		}),
		resumeSession: vi.fn(async (sid: string): Promise<SessionResult> => ({
			sessionId: sid,
		})),
	};
	const initialize = vi.fn(async () => {
		initialized = true;
	});
	return { client, initialize };
}

interface TabOptions {
	restoredSessionId?: string | null;
	forkFromSessionId?: string | null;
	/** Local fork branch (lossy) vs server fork. */
	forkLossy?: boolean;
	storedEngine?: "v2" | "v3";
	running?: "v2" | "v3";
	transcript: ChatMessage[];
	knownToAgent?: string[];
	emptyLoad?: boolean;
}

function mountTab(opts: TabOptions) {
	const wire = vi.fn(async (_sid: string, _content: PromptContent[]) => {});
	const saveSessionLocally = vi.fn(async () => {});
	const acp = fakeClient(
		opts.running ?? "v2",
		opts.knownToAgent ?? [],
		opts.emptyLoad ?? false,
	);
	const transcript = JSON.parse(JSON.stringify(opts.transcript)) as ChatMessage[];
	const liveSession = { sessionId: null as string | null };
	const continuesRef: { current: (() => boolean) | null } = { current: null };

	const hook = renderHook(() => {
		const agentMessages = useAgentMessages(
			{ sendPrompt: wire } as unknown as AMParams[0],
			{
				// agent-suggested so a wrongly armed title rubric would show up.
				getSnapshot: () => ({
					titleStrategy: "agent-suggested",
					windowsWslMode: false,
				}),
			} as unknown as AMParams[1],
			{ getAllFiles: () => [], readNote: vi.fn() } as unknown as AMParams[2],
			{
				sessionId: liveSession.sessionId,
				promptCapabilities: { embeddedContext: false },
				authMethods: [],
			} as unknown as AMParams[3],
			vi.fn(),
		);
		const actions = useChatActions(
			deepMock({
				app: deepMock({
					metadataCache: deepMock({ getFirstLinkpathDest: () => null }),
				}),
			}) as CAParams[0],
			deepMock({
				clearError: vi.fn(),
				sendMessage: agentMessages.sendMessage,
			}) as CAParams[1],
			deepMock({ saveSessionLocally }) as CAParams[2],
			deepMock() as CAParams[3],
			{
				sessionId: liveSession.sessionId,
				agentId: "kiro-cli",
				promptCapabilities: { embeddedContext: false },
			} as unknown as CAParams[4],
			transcript,
			{ activeNoteAsDefaultContext: false } as unknown as CAParams[6],
			"/vault",
			{ notes: [], add: vi.fn() } as unknown as CAParams[8],
			null,
			null,
			false,
			{ current: null } as CAParams[12],
			"/vault",
			"/vault",
			undefined,
			continuesRef,
		);
		const lazy = useLazySession({
			restoredSessionId: opts.restoredSessionId ?? null,
			forkFromSessionId: opts.forkFromSessionId ?? null,
			forkExistingSession: opts.forkFromSessionId
				? async () => {
						liveSession.sessionId = "branch-1";
						return opts.forkLossy
							? { ok: true, sessionId: "branch-1", lossy: true }
							: { ok: true, sessionId: "branch-1" };
					}
				: undefined,
			acquireNewSession: async () => {
				liveSession.sessionId = "new-1";
				return { ok: true, sessionId: "new-1" };
			},
			loadExistingSession: (id) =>
				reconnectExistingSession({
					sessionId: id,
					cwd: "/vault",
					client: acp.client,
					initialize: acp.initialize,
					haveLocalHistory: () => transcript.length > 0,
					onLoaded: (r) => {
						liveSession.sessionId = r.sessionId;
					},
					setIgnoreUpdates: () => {},
					storedEngine: opts.storedEngine,
				}),
			onSessionFallback: actions.armFallbackCarryOver,
			onReset: actions.clearFallbackCarryOver,
			sendPrompt: vi.fn(),
			debounceMs: 0,
		});
		continuesRef.current = lazy.continuesExistingSession;
		return { lazy, actions };
	});

	/** Send as ChatPanel does: hold, acquire, then the connect-flush sends. */
	async function send(text: string) {
		await act(async () => {
			hook.result.current.lazy.onSendClick(text);
		});
		await waitFor(() => expect(hook.result.current.lazy.state).toBe("ready"));
		hook.rerender();
		await act(async () => {
			await hook.result.current.actions.handleSendMessage(text);
		});
	}

	/** A later send on a ready tab. */
	async function sendAgain(text: string) {
		hook.rerender();
		await act(async () => {
			await hook.result.current.actions.handleSendMessage(text);
		});
	}

	/** The prompt text of send number `n` (0-based), blocks joined in order. */
	function sent(n: number): string {
		return wire.mock.calls[n][1].map(textOf).join("\n\n");
	}

	return { hook, wire, send, sendAgain, sent, saveSessionLocally, liveSession };
}

/** Instruction, then transcript, then the user's text — and only once. */
function expectFallbackFirstSend(text: string, userText: string) {
	const i = text.indexOf(INSTRUCTION);
	const t = text.indexOf(TRANSCRIPT);
	const u = text.lastIndexOf(userText);
	expect(i).toBeGreaterThanOrEqual(0);
	expect(t).toBeGreaterThan(i);
	expect(u).toBeGreaterThan(t);
	expect(text.split(INSTRUCTION).length - 1).toBe(1);
	// A continued chat keeps its title: no rubric.
	expect(text).not.toContain(RUBRIC_MARK);
}

const Q = "What number did I ask you to remember?";

// ---------------------------------------------------------------------------
// Fallback paths: the new session's first send carries the instruction
// ---------------------------------------------------------------------------

describe("I265 fallback: the new session's first send carries the system instruction", () => {
	it("failed load (V2, unknown id)", async () => {
		const tab = mountTab({
			restoredSessionId: "sess_unknown",
			storedEngine: "v2",
			running: "v2",
			transcript: REMEMBER_7,
		});
		await tab.send(Q);
		expect(tab.wire.mock.calls[0][0]).toBe("new-1");
		expectFallbackFirstSend(tab.sent(0), Q);
		expect(tab.saveSessionLocally).not.toHaveBeenCalled();

		await tab.sendAgain("And doubled?");
		expect(tab.sent(1)).not.toContain(INSTRUCTION);
		expect(tab.sent(1)).not.toContain(TRANSCRIPT);
	});

	it("engine change (V3 chat on V2, D2)", async () => {
		const tab = mountTab({
			restoredSessionId: "v3-sess",
			storedEngine: "v3",
			running: "v2",
			transcript: REMEMBER_7,
		});
		await tab.send(Q);
		expect(tab.hook.result.current.lazy.fallbackReason).toBe("engine-changed");
		expectFallbackFirstSend(tab.sent(0), Q);
		expect(tab.saveSessionLocally).not.toHaveBeenCalled();
	});

	it("empty load (V3 loads an id it never had, I264)", async () => {
		const tab = mountTab({
			restoredSessionId: "v3-seeded",
			storedEngine: "v3",
			running: "v3",
			transcript: REMEMBER_7,
			emptyLoad: true,
		});
		await tab.send(Q);
		expect(tab.wire.mock.calls[0][0]).toBe("new-1");
		expectFallbackFirstSend(tab.sent(0), Q);
		await tab.sendAgain("And doubled?");
		expect(tab.sent(1)).not.toContain(INSTRUCTION);
	});

	it("local fork branch (lossy)", async () => {
		const tab = mountTab({
			forkFromSessionId: "orig",
			forkLossy: true,
			transcript: REMEMBER_7,
		});
		await tab.send(Q);
		expect(tab.wire.mock.calls[0][0]).toBe("branch-1");
		expectFallbackFirstSend(tab.sent(0), Q);
		expect(tab.saveSessionLocally).not.toHaveBeenCalled();
	});

	it("soft reload that starts fresh, on a live tab", async () => {
		// A live tab mid-chat: its session is bound and the transcript is on
		// screen, so a send is a continued turn.
		const tab = mountTab({ transcript: REMEMBER_7 });
		await act(async () => {
			await tab.hook.result.current.lazy.acquireNow();
		});
		await tab.sendAgain("Still there?");
		expect(tab.sent(0)).not.toContain(INSTRUCTION);

		await act(async () => {
			await tab.hook.result.current.lazy.reloadNow(async () =>
				reloadResultToAcquisition({
					resumed: false,
					reason: "resume-failed",
					sessionId: "fresh-1",
				}),
			);
		});
		tab.liveSession.sessionId = "fresh-1";
		await tab.sendAgain(Q);
		expectFallbackFirstSend(tab.sent(1), Q);
		expect(tab.saveSessionLocally).not.toHaveBeenCalled();
		await tab.sendAgain("And doubled?");
		expect(tab.sent(2)).not.toContain(INSTRUCTION);
	});

	it("soft reload that starts fresh, on a restored tab that loaded (restored id still bound)", async () => {
		const tab = mountTab({
			restoredSessionId: "sess_known",
			storedEngine: "v2",
			running: "v2",
			transcript: REMEMBER_7,
			knownToAgent: ["sess_known"],
		});
		await tab.send("Hello again");
		// A real load: no instruction.
		expect(tab.wire.mock.calls[0][0]).toBe("sess_known");
		expect(tab.sent(0)).not.toContain(INSTRUCTION);

		await act(async () => {
			await tab.hook.result.current.lazy.reloadNow(async () =>
				reloadResultToAcquisition({
					resumed: false,
					reason: "resume-failed",
					sessionId: "fresh-1",
				}),
			);
		});
		tab.liveSession.sessionId = "fresh-1";
		await tab.sendAgain(Q);
		expectFallbackFirstSend(tab.sent(1), Q);
		await tab.sendAgain("And doubled?");
		expect(tab.sent(2)).not.toContain(INSTRUCTION);
	});

	it("a message queued during a soft reload that starts fresh carries it", async () => {
		const tab = mountTab({
			restoredSessionId: "sess_known",
			storedEngine: "v2",
			running: "v2",
			transcript: REMEMBER_7,
			knownToAgent: ["sess_known"],
		});
		await tab.send("Hello again");
		let finish: (() => void) | null = null;
		let reload: Promise<void> | null = null;
		await act(async () => {
			reload = tab.hook.result.current.lazy.reloadNow(
				() =>
					new Promise((resolve) => {
						finish = () =>
							resolve(
								reloadResultToAcquisition({
									resumed: false,
									reason: "resume-failed",
									sessionId: "fresh-1",
								}),
							);
					}),
			);
		});
		expect(tab.hook.result.current.lazy.state).toBe("connecting");
		await act(async () => {
			finish?.();
			await reload;
		});
		await waitFor(() => expect(tab.hook.result.current.lazy.state).toBe("ready"));
		// The connect-flush sends the held message now.
		tab.liveSession.sessionId = "fresh-1";
		await tab.sendAgain(Q);
		expectFallbackFirstSend(tab.sent(1), Q);
	});
});

// ---------------------------------------------------------------------------
// Negative cases: a continued session never gets it again
// ---------------------------------------------------------------------------

describe("I265 continued sessions never re-send the system instruction", () => {
	it("a real load of a restored tab with local history", async () => {
		const tab = mountTab({
			restoredSessionId: "sess_known",
			storedEngine: "v2",
			running: "v2",
			transcript: REMEMBER_7,
			knownToAgent: ["sess_known"],
		});
		await tab.send(Q);
		expect(tab.sent(0)).not.toContain(INSTRUCTION);
		expect(tab.sent(0)).not.toContain(TRANSCRIPT);
	});

	it("I241: a restored agent-only tab (empty transcript) that loads", async () => {
		const tab = mountTab({
			restoredSessionId: "sess_known",
			storedEngine: "v2",
			running: "v2",
			transcript: [],
			knownToAgent: ["sess_known"],
		});
		await tab.send(Q);
		expect(tab.sent(0)).not.toContain(INSTRUCTION);
		expect(tab.saveSessionLocally).not.toHaveBeenCalled();
	});

	it("a server fork", async () => {
		const tab = mountTab({
			forkFromSessionId: "orig",
			forkLossy: false,
			transcript: REMEMBER_7,
		});
		await tab.send(Q);
		expect(tab.wire.mock.calls[0][0]).toBe("branch-1");
		expect(tab.sent(0)).not.toContain(INSTRUCTION);
	});

	it("reset (New chat, agent switch) drops an armed fallback before it is sent", async () => {
		const tab = mountTab({ transcript: REMEMBER_7 });
		act(() => tab.hook.result.current.actions.armFallbackCarryOver("unavailable"));
		// reset() calls onReset, which drops the fallback transcript and flag.
		act(() => tab.hook.result.current.lazy.reset());
		await act(async () => {
			await tab.hook.result.current.lazy.acquireNow();
		});
		await tab.sendAgain(Q);
		expect(tab.sent(0)).not.toContain(INSTRUCTION);
		expect(tab.sent(0)).not.toContain(TRANSCRIPT);
	});

	it("a brand-new chat keeps its full first message (instruction and title rubric)", async () => {
		const tab = mountTab({ transcript: [] });
		await tab.send("hi");
		const first = tab.sent(0);
		expect(first.split(INSTRUCTION).length - 1).toBe(1);
		expect(first).toContain(RUBRIC_MARK);
		expect(tab.saveSessionLocally).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// Send order shared with agent switch, and replay hides both blocks
// ---------------------------------------------------------------------------

describe("I265 order and replay", () => {
	it("agent switch with carry-over: instruction, then transcript, then user text", async () => {
		const tab = mountTab({ transcript: [] });
		act(() =>
			tab.hook.result.current.actions.setCarryOverBlocks([
				{
					type: "text",
					text: "<carry_over_transcript>\nUser: Remember the number 7.\n</carry_over_transcript>",
				},
			]),
		);
		await tab.send(Q);
		const text = tab.sent(0);
		expect(text.indexOf(INSTRUCTION)).toBeGreaterThanOrEqual(0);
		expect(text.indexOf(TRANSCRIPT)).toBeGreaterThan(text.indexOf(INSTRUCTION));
		expect(text.lastIndexOf(Q)).toBeGreaterThan(text.indexOf(TRANSCRIPT));
	});

	it("a replayed fallback first message shows only what the user typed", async () => {
		const tab = mountTab({
			restoredSessionId: "sess_unknown",
			storedEngine: "v2",
			running: "v2",
			transcript: REMEMBER_7,
		});
		await tab.send(Q);
		// Agents replay the prompt's text blocks joined, as Kiro and Claude do.
		expect(stripInjectedPromptText(tab.sent(0)).text).toBe(Q);
	});
});
