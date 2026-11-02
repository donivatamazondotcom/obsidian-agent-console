/**
 * I246 — every fallback to a new session sends the transcript once, on the
 * next send ([[I246 Fallback to a new session never sends the transcript]]).
 *
 * Before the fix, a restored tab whose session couldn't be reopened fell back
 * to a new session and showed "working from a transcript", but nothing sent
 * the transcript: the agent answered that the conversation had just started.
 * Live repros: the D2 smoke (engine change) and the I248 repro (lane 3,
 * 11/02: an unknown session id on V2, failed load). Both are pinned below as
 * separate cases.
 *
 * Seams (R2):
 * - `useLazySession`: the single acquisition owner (real hook).
 * - `reconnectExistingSession`: what ChatPanel's `loadExistingSession` calls;
 *   only the ACP client port is faked (R4).
 * - `useChatActions`: the owner of pending carry-over blocks (real hook).
 * - `useAgentMessages.sendMessage`: builds the real prompt (`contextNotes`
 *   set) and hands it to the ACP port, which is faked (R4).
 * - `stripInjectedPromptText`: what a later replay runs through (I222).
 *
 * Assertions are on wire content, call order and returned text (R3).
 * Expected values are literals, not rebuilt with the builder (R5).
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import {
	useLazySession,
	type SessionAcquisitionResult,
	type UseLazySessionOptions,
} from "../useLazySession";
import { reloadResultToAcquisition } from "../reloadSessionFlow";
import {
	reconnectExistingSession,
	type ReconnectClientPort,
} from "../loadExistingSessionFlow";
import { useChatActions } from "../useChatActions";
import { useAgentMessages } from "../useAgentMessages";
import { buildCarryOverBlocks } from "../../services/carry-over-builder";
import { stripInjectedPromptText } from "../../services/message-sender";
import { NO_AGENT_CAPABILITIES, type SessionResult } from "../../types/session";
import type { ChatMessage, PromptContent } from "../../types/chat";
import type { SessionFallbackReason } from "../../resolvers/session-engine";

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

/** The I248 repro's local transcript ("V3 chat" tab). */
const REMEMBER_7: ChatMessage[] = [
	msg("user", "Remember the number 7.", "u1"),
	msg("assistant", "Got it, I will remember 7.", "a1"),
];

function textOf(block: PromptContent | undefined): string {
	if (!block) return "";
	if (block.type === "text") return block.text;
	if (block.type === "resource") return block.resource.text ?? "";
	return "";
}

function lazyOptions(
	overrides: Partial<UseLazySessionOptions> = {},
): UseLazySessionOptions {
	return {
		acquireNewSession: vi
			.fn()
			.mockResolvedValue({ ok: true, sessionId: "new-1" }),
		loadExistingSession: vi
			.fn()
			.mockResolvedValue({ ok: true, sessionId: "loaded-1" }),
		sendPrompt: vi.fn().mockResolvedValue(undefined),
		debounceMs: 0,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// 1. The acquisition owner reports every lossy acquisition, before ready
// ---------------------------------------------------------------------------

describe("I246 useLazySession: onSessionFallback", () => {
	// `timeline` interleaves each render's state with the callback, so a test
	// can assert the fallback was reported before the first `ready` render
	// (the render the connect-flush reacts to).
	function mountWithSpy(overrides: Partial<UseLazySessionOptions>) {
		const seen: Array<{ reason: SessionFallbackReason }> = [];
		const timeline: string[] = [];
		const onReset = vi.fn();
		const hook = renderHook(() => {
			const api = useLazySession(
				lazyOptions({
					...overrides,
					onSessionFallback: (reason) => {
						seen.push({ reason });
						timeline.push(`fallback:${reason}`);
					},
					onReset,
				}),
			);
			timeline.push(api.state);
			return api;
		});
		return { hook, seen, onReset, timeline };
	}

	function reportedBeforeReady(timeline: string[]): boolean {
		const marker = timeline.findIndex((e) => e.startsWith("fallback:"));
		const ready = timeline.indexOf("ready");
		return marker >= 0 && ready > marker;
	}

	it("a failed load reports unavailable once", async () => {
		const { hook, seen, timeline } = mountWithSpy({
			restoredSessionId: "sess_i248unknown0001",
			loadExistingSession: vi.fn().mockResolvedValue({
				ok: false,
				error: new Error("Session not found"),
			}),
		});
		await act(async () => {
			hook.result.current.onSendClick("What number did I ask you to remember?");
		});
		await waitFor(() => expect(hook.result.current.state).toBe("ready"));
		expect(seen).toEqual([{ reason: "unavailable" }]);
		expect(reportedBeforeReady(timeline)).toBe(true);
	});

	it("an engine change reports engine-changed", async () => {
		const { hook, seen } = mountWithSpy({
			restoredSessionId: "v3-abc",
			loadExistingSession: vi.fn().mockResolvedValue({
				ok: false,
				error: new Error("engine changed"),
				fallbackReason: "engine-changed",
			}),
		});
		await act(async () => {
			hook.result.current.onSendClick("hi");
		});
		await waitFor(() => expect(hook.result.current.state).toBe("ready"));
		expect(seen.map((s) => s.reason)).toEqual(["engine-changed"]);
	});

	it("a local fork branch reports unavailable; a server fork reports nothing", async () => {
		const local = mountWithSpy({
			forkFromSessionId: "orig",
			forkExistingSession: vi
				.fn()
				.mockResolvedValue({ ok: true, sessionId: "branch", lossy: true }),
			eagerAcquire: true,
		});
		await waitFor(() => expect(local.hook.result.current.state).toBe("ready"));
		expect(local.seen.map((s) => s.reason)).toEqual(["unavailable"]);

		const server = mountWithSpy({
			forkFromSessionId: "orig",
			forkExistingSession: vi
				.fn()
				.mockResolvedValue({ ok: true, sessionId: "branch" }),
			eagerAcquire: true,
		});
		await waitFor(() => expect(server.hook.result.current.state).toBe("ready"));
		expect(server.seen).toEqual([]);
	});

	it("reset and acquireNow call onReset, so New chat drops an unsent transcript", async () => {
		const { hook, onReset } = mountWithSpy({});
		act(() => hook.result.current.reset());
		await act(async () => {
			await hook.result.current.acquireNow();
		});
		expect(onReset).toHaveBeenCalledTimes(2);
	});

	it("a successful load reports nothing", async () => {
		const { hook, seen } = mountWithSpy({ restoredSessionId: "kept" });
		await act(async () => {
			hook.result.current.onSendClick("hi");
		});
		await waitFor(() => expect(hook.result.current.state).toBe("ready"));
		expect(seen).toEqual([]);
	});

	it("a soft reload that starts fresh reports its reason; a resume reports nothing", async () => {
		const { hook, seen, timeline } = mountWithSpy({});
		await act(async () => {
			await hook.result.current.acquireNow();
		});
		timeline.length = 0;
		const fresh: SessionAcquisitionResult = reloadResultToAcquisition({
			resumed: false,
			reason: "resume-failed",
			sessionId: "fresh-1",
		});
		await act(async () => {
			await hook.result.current.reloadNow(async () => fresh);
		});
		const engine: SessionAcquisitionResult = reloadResultToAcquisition({
			resumed: false,
			reason: "engine-changed",
			sessionId: "fresh-2",
		});
		await act(async () => {
			await hook.result.current.reloadNow(async () => engine);
		});
		const resumed = reloadResultToAcquisition({
			resumed: true,
			sessionId: "fresh-2",
		});
		await act(async () => {
			await hook.result.current.reloadNow(async () => resumed);
		});
		expect(seen.map((s) => s.reason)).toEqual(["unavailable", "engine-changed"]);
		expect(reportedBeforeReady(timeline)).toBe(true);
		// Soft reload keeps its toast; it doesn't raise the in-chat notice.
		expect(hook.result.current.isFallbackRecovery).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 2. Builder: fallback wording, and a later replay hides the block (I222)
// ---------------------------------------------------------------------------

describe("I246 carry-over builder: the fallback form", () => {
	it("plain-text form names this conversation, not a switch", () => {
		const [block] = buildCarryOverBlocks(REMEMBER_7, false, undefined, "fallback");
		const text = textOf(block);
		expect(text.startsWith("<carry_over_transcript>\n")).toBe(true);
		expect(text).toContain("User: Remember the number 7.");
		expect(text).toContain("Assistant: Got it, I will remember 7.");
		expect(text).toContain("The earlier session couldn't be reopened");
		expect(text).not.toContain("switching to you");
	});

	it("embedded form sends the transcript as a resource plus the fallback hint", () => {
		const blocks = buildCarryOverBlocks(REMEMBER_7, true, undefined, "fallback");
		expect(blocks[0].type).toBe("resource");
		expect(textOf(blocks[0])).toBe(
			"User: Remember the number 7.\n\nAssistant: Got it, I will remember 7.",
		);
		expect(textOf(blocks[1])).toBe(
			"The messages above are this conversation so far. The earlier session couldn't be reopened, so this is a new session. Continue from where it left off.",
		);
	});

	it("a replayed prompt shows only what the user typed, in both forms", () => {
		const user = "What number did I ask you to remember?";
		const xml = textOf(buildCarryOverBlocks(REMEMBER_7, false, undefined, "fallback")[0]);
		// Claude replays one chunk per text block; V3 joins text blocks with \n.
		expect(stripInjectedPromptText(`${xml}${user}`).text).toBe(user);
		expect(stripInjectedPromptText(`${xml}\n${user}`).text).toBe(user);
		const hint = textOf(buildCarryOverBlocks(REMEMBER_7, true, undefined, "fallback")[1]);
		expect(stripInjectedPromptText(`${hint}\n${user}`).text).toBe(user);
	});
});

// ---------------------------------------------------------------------------
// 3. Composed: restored tab → failed load → first send carries it once
// ---------------------------------------------------------------------------

type CAParams = Parameters<typeof useChatActions>;
type AMParams = Parameters<typeof useAgentMessages>;

/** Recursive proxy for the many incidental reads (same as carry-over-delivery). */
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

/**
 * ACP client port. `known` ids load with a replay; anything else fails like
 * Kiro V2 does, or, with `emptyLoad`, succeeds with no replay like Kiro V3
 * (I264).
 */
function fakeClient(
	engine: "v2" | "v3",
	known: string[] = [],
	emptyLoad = false,
) {
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

/**
 * The restored tab as ChatPanel wires it: the lazy owner reports a fallback to
 * the carry-over owner, the connect-flush sends the held message, and the real
 * `useAgentMessages` builds the prompt the agent receives.
 */
function mountRestoredTab(opts: {
	restoredSessionId: string;
	storedEngine?: "v2" | "v3";
	running: "v2" | "v3";
	transcript: ChatMessage[];
	knownToAgent?: string[];
	/** Unknown ids load empty instead of failing (Kiro V3, I264). */
	emptyLoad?: boolean;
}) {
	const wire = vi.fn(async (_sid: string, _content: PromptContent[]) => {});
	const acp = fakeClient(opts.running, opts.knownToAgent, opts.emptyLoad);
	const transcript = JSON.parse(JSON.stringify(opts.transcript)) as ChatMessage[];
	const liveSession = { sessionId: null as string | null };

	const hook = renderHook(() => {
		const agentMessages = useAgentMessages(
			{ sendPrompt: wire } as unknown as AMParams[0],
			{
				getSnapshot: () => ({ titleStrategy: "off", windowsWslMode: false }),
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
			deepMock({ saveSessionLocally: vi.fn() }) as CAParams[2],
			deepMock() as CAParams[3],
			{
				sessionId: liveSession.sessionId,
				agentId: "kiro-cli",
				promptCapabilities: { embeddedContext: false },
			} as unknown as CAParams[4],
			transcript,
			{ activeNoteAsDefaultContext: false } as unknown as CAParams[6],
			"",
			{ notes: [], add: vi.fn() } as unknown as CAParams[8],
			null,
			null,
			false,
			{ current: null } as CAParams[12],
		);
		const lazy = useLazySession({
			restoredSessionId: opts.restoredSessionId,
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
			sendPrompt: vi.fn(),
			debounceMs: 0,
		});
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

	return { hook, wire, send, transcript };
}

describe("I246 restored tab: the first send after a fallback carries the transcript once", () => {
	it("I248 repro: unknown session id on V2, failed load → the agent gets the earlier turns", async () => {
		const tab = mountRestoredTab({
			restoredSessionId: "sess_i248unknown0001",
			storedEngine: "v2",
			running: "v2",
			transcript: REMEMBER_7,
		});

		await tab.send("What number did I ask you to remember?");
		expect(tab.hook.result.current.lazy.isFallbackRecovery).toBe(true);
		expect(tab.hook.result.current.lazy.fallbackReason).toBe("unavailable");

		const [sid, content] = tab.wire.mock.calls[0];
		expect(sid).toBe("new-1");
		// I265: the system instruction leads; the transcript comes next.
		expect(textOf(content[0])).toContain("<obsidian_system_instruction>");
		const head = textOf(content[1]);
		expect(head).toContain("<carry_over_transcript>");
		expect(head).toContain("User: Remember the number 7.");
		expect(head).toContain("Assistant: Got it, I will remember 7.");
		expect(content.map(textOf)).toContain("What number did I ask you to remember?");

		// Once: the next send carries no transcript.
		await act(async () => {
			await tab.hook.result.current.actions.handleSendMessage("And doubled?");
		});
		const second = tab.wire.mock.calls[1][1];
		expect(second.map(textOf).join("\n")).not.toContain("carry_over_transcript");

		// The earlier messages are left as they were (I248 observation).
		expect(tab.transcript.map((m) => m.id)).toEqual(["u1", "a1"]);
	});

	it("D2: a V3 chat on V2 starts fresh and the agent gets the earlier turns", async () => {
		const tab = mountRestoredTab({
			restoredSessionId: "v3-sess-7",
			storedEngine: "v3",
			running: "v2",
			transcript: REMEMBER_7,
		});
		await tab.send("What number did I ask you to remember?");
		expect(tab.hook.result.current.lazy.fallbackReason).toBe("engine-changed");
		// I265: block 0 is the system instruction; the transcript follows.
		expect(textOf(tab.wire.mock.calls[0][1][1])).toContain(
			"User: Remember the number 7.",
		);
	});

	it("a session the agent still has loads and sends no transcript", async () => {
		const tab = mountRestoredTab({
			restoredSessionId: "sess_known",
			storedEngine: "v2",
			running: "v2",
			transcript: REMEMBER_7,
			knownToAgent: ["sess_known"],
		});
		await tab.send("What number did I ask you to remember?");
		expect(tab.hook.result.current.lazy.isFallbackRecovery).toBe(false);
		const content = tab.wire.mock.calls[0][1];
		expect(content.map(textOf).join("\n")).not.toContain("carry_over_transcript");
	});
});

describe("I264 restored tab: Kiro V3 loads an id it never had, empty", () => {
	it("the empty load falls back: the first send carries the transcript once, with the notice", async () => {
		const tab = mountRestoredTab({
			restoredSessionId: "v3-seeded-unknown",
			storedEngine: "v3",
			running: "v3",
			transcript: REMEMBER_7,
			emptyLoad: true,
		});
		await tab.send("What number did I ask you to remember?");
		expect(tab.hook.result.current.lazy.isFallbackRecovery).toBe(true);
		expect(tab.hook.result.current.lazy.fallbackReason).toBe("unavailable");
		const [sid, content] = tab.wire.mock.calls[0];
		expect(sid).toBe("new-1");
		// I265: block 0 is the system instruction; the transcript follows.
		expect(textOf(content[1])).toContain("User: Remember the number 7.");

		await act(async () => {
			await tab.hook.result.current.actions.handleSendMessage("And doubled?");
		});
		expect(tab.wire.mock.calls[1][1].map(textOf).join("\n")).not.toContain(
			"carry_over_transcript",
		);
	});

	it("a real V3 load sends no transcript and shows no notice", async () => {
		const tab = mountRestoredTab({
			restoredSessionId: "v3-real",
			storedEngine: "v3",
			running: "v3",
			transcript: REMEMBER_7,
			knownToAgent: ["v3-real"],
			emptyLoad: true,
		});
		await tab.send("What number did I ask you to remember?");
		expect(tab.hook.result.current.lazy.isFallbackRecovery).toBe(false);
		expect(tab.wire.mock.calls[0][0]).toBe("v3-real");
		expect(tab.wire.mock.calls[0][1].map(textOf).join("\n")).not.toContain(
			"carry_over_transcript",
		);
	});

	it("an empty chat that loads empty sends nothing extra and shows no notice", async () => {
		const tab = mountRestoredTab({
			restoredSessionId: "v3-empty-chat",
			storedEngine: "v3",
			running: "v3",
			transcript: [],
			emptyLoad: true,
		});
		await tab.send("Hello");
		expect(tab.hook.result.current.lazy.isFallbackRecovery).toBe(false);
		expect(tab.wire.mock.calls[0][0]).toBe("v3-empty-chat");
		const sent = tab.wire.mock.calls[0][1].map(textOf);
		expect(sent.join("\n")).not.toContain("carry_over_transcript");
		expect(sent).toContain("Hello");
	});
});

// ---------------------------------------------------------------------------
// 4. The carry-over owner: arm, consume once, clear on New chat
// ---------------------------------------------------------------------------

describe("I246 useChatActions: fallback carry-over", () => {
	function mountActions(messages: ChatMessage[], embedded = false) {
		const sendMessage = vi.fn((_c: string, _o: { carryOverBlocks?: PromptContent[] }) =>
			Promise.resolve(),
		);
		const { result } = renderHook(() =>
			useChatActions(
				deepMock({
					app: deepMock({
						metadataCache: deepMock({ getFirstLinkpathDest: () => null }),
					}),
				}) as CAParams[0],
				deepMock({ clearError: vi.fn(), sendMessage }) as CAParams[1],
				deepMock({ saveSessionLocally: vi.fn() }) as CAParams[2],
				deepMock() as CAParams[3],
				{
					sessionId: "s1",
					agentId: "kiro-cli",
					promptCapabilities: { embeddedContext: embedded },
				} as unknown as CAParams[4],
				messages,
				{ activeNoteAsDefaultContext: false } as unknown as CAParams[6],
				"",
				{ notes: [], add: vi.fn() } as unknown as CAParams[8],
				null,
				null,
				false,
				{ current: null } as CAParams[12],
			),
		);
		return { result, sendMessage };
	}

	it("an empty transcript arms nothing", async () => {
		const { result, sendMessage } = mountActions([]);
		act(() => result.current.armFallbackCarryOver("unavailable"));
		await act(async () => {
			await result.current.handleSendMessage("hi");
		});
		expect(sendMessage.mock.calls[0][1].carryOverBlocks).toBeUndefined();
	});

	it("always sends plain text, even when the session advertised embedded context", async () => {
		// Smoke 11/02 (A5): a soft reload from Kiro V3 (embeddedContext: true)
		// to V2 (false) fires the fallback before React holds V2's
		// capabilities. A resource block armed then was dropped by V2, so the
		// agent saw only the hint and answered NONE. Plain text works on every
		// agent, the same choice the agent-switch path makes.
		const { result, sendMessage } = mountActions(REMEMBER_7, true);
		act(() => result.current.armFallbackCarryOver("unavailable"));
		await act(async () => {
			await result.current.handleSendMessage("hi");
		});
		const blocks = sendMessage.mock.calls[0][1].carryOverBlocks ?? [];
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe("text");
		expect(textOf(blocks[0])).toContain("User: Remember the number 7.");
	});

	it("New chat drops an armed fallback transcript but keeps switch blocks", async () => {
		const { result, sendMessage } = mountActions(REMEMBER_7);
		act(() => result.current.armFallbackCarryOver("unavailable"));
		act(() => result.current.clearFallbackCarryOver());
		await act(async () => {
			await result.current.handleSendMessage("first");
		});
		expect(sendMessage.mock.calls[0][1].carryOverBlocks).toBeUndefined();

		const switchBlocks = buildCarryOverBlocks(REMEMBER_7, false);
		act(() => result.current.setCarryOverBlocks(switchBlocks));
		act(() => result.current.clearFallbackCarryOver());
		await act(async () => {
			await result.current.handleSendMessage("second");
		});
		expect(sendMessage.mock.calls[1][1].carryOverBlocks).toEqual(switchBlocks);
	});
});
