/**
 * I280 — a retry after a failed fallback session keeps the fallback.
 *
 * A restored tab whose load fails falls back to a new session (I246). When
 * that new session ALSO fails, the tab goes to `error`. Before the fix the
 * owner forgot the restored id anyway, so the retry took the plain
 * new-session branch: `onSessionFallback` never fired, and the agent's first
 * prompt had neither the system instruction (I265) nor the transcript (I246).
 *
 * Fix: the restored id is kept until a fallback session exists, so a retry
 * loads again and falls back if it must. The notice flags rise only once the
 * fallback session exists.
 *
 * Seams (R2): the real `useLazySession` owner, the real `reconnectExistingSession`
 * load flow, the real `useChatActions` and `useAgentMessages` (which build the
 * prompt the agent receives, `contextNotes` path). Only the ACP port and the
 * settings / vault ports are faked (R4). Assertions are on the prompt the
 * agent receives, the owner's public state and the id ChatPanel persists (R3).
 * Expected values are literals (R5).
 *
 * Spec: [[I280 A retry after a failed fallback session loses the fallback]].
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useLazySession, type SessionAcquisitionResult } from "../useLazySession";
import {
	reconnectExistingSession,
	type ReconnectClientPort,
} from "../loadExistingSessionFlow";
import { useChatActions } from "../useChatActions";
import { useAgentMessages } from "../useAgentMessages";
import {
	keptIdForSave,
	resolveSessionIdForSave,
} from "../../services/session-helpers";
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
const Q = "What number did I ask you to remember?";

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

/** A promise the test resolves by hand, to hold an await open. */
function gate() {
	let open!: () => void;
	const promise = new Promise<void>((r) => {
		open = r;
	});
	return { promise, open };
}

type Outcome = "ok" | "fail";
type LoadOutcome = "ok" | "fail" | "empty";
/** A scripted step: an outcome, optionally held until a gate opens. */
type Step<T> = T | { after: Promise<void>; then: T };

function take<T>(script: Step<T>[], fallback: T): { wait?: Promise<void>; value: T } {
	const step = script.length > 0 ? script.shift()! : fallback;
	if (typeof step === "object" && step !== null && "after" in step) {
		return { wait: step.after, value: step.then };
	}
	return { value: step as T };
}

interface TabOptions {
	restoredSessionId?: string | null;
	forkFromSessionId?: string | null;
	storedEngine?: "v2" | "v3";
	running?: "v2" | "v3";
	transcript?: ChatMessage[];
	/** One entry per agent launch attempt on the load path (initialize). */
	initialize?: Step<Outcome>[];
	/** One entry per `session/load`. */
	load?: Step<LoadOutcome>[];
	/** One entry per new-session attempt (ChatPanel's `acquireNewSession`). */
	newSession?: Step<Outcome>[];
	/** The fork callback's outcome (local branch, lossy). */
	fork?: Step<Outcome>[];
}

function mountTab(opts: TabOptions) {
	const wire = vi.fn(async (_sid: string, _content: PromptContent[]) => {});
	const initScript = [...(opts.initialize ?? [])];
	const loadScript = [...(opts.load ?? [])];
	const newScript = [...(opts.newSession ?? [])];
	const forkScript = [...(opts.fork ?? [])];
	const transcript = JSON.parse(
		JSON.stringify(opts.transcript ?? REMEMBER_7),
	) as ChatMessage[];
	const liveSession = { sessionId: null as string | null };
	const continuesRef: { current: (() => boolean) | null } = { current: null };
	const fallbackSpy = vi.fn();
	let newCount = 0;
	// ChatPanel's shared error state (the banner renders from it):
	// createSession clears it first and sets it on failure.
	const banner = { error: null as string | null };

	let initialized = false;
	const client: ReconnectClientPort = {
		isInitialized: () => initialized,
		getInitializeResult: () =>
			initialized
				? {
						capabilities: { ...NO_AGENT_CAPABILITIES, restoresViaLoad: true },
						kiroEngine: opts.running ?? "v2",
					}
				: null,
		loadSession: vi.fn(async (sid: string): Promise<SessionResult> => {
			const step = take(loadScript, "fail");
			if (step.wait) await step.wait;
			if (step.value === "ok") {
				return { sessionId: sid, replayedConversationUpdates: 2 };
			}
			if (step.value === "empty") {
				return { sessionId: sid, replayedConversationUpdates: 0 };
			}
			throw new Error("Session not found");
		}),
		resumeSession: vi.fn(async (sid: string): Promise<SessionResult> => ({
			sessionId: sid,
		})),
	};
	const initialize = vi.fn(async () => {
		const step = take(initScript, "ok");
		if (step.wait) await step.wait;
		if (step.value === "fail") throw new Error("Agent exited before initialize");
		initialized = true;
	});
	const acquireNewSession = vi.fn(async (): Promise<SessionAcquisitionResult> => {
		banner.error = null;
		const step = take(newScript, "ok");
		if (step.wait) await step.wait;
		if (step.value === "fail") {
			banner.error = "Session Creation Failed";
			return { ok: false, error: new Error("Session creation failed") };
		}
		newCount += 1;
		const sid = `new-${newCount}`;
		liveSession.sessionId = sid;
		return { ok: true, sessionId: sid };
	});
	const loadExistingSession = vi.fn((id: string) =>
		reconnectExistingSession({
			sessionId: id,
			cwd: "/vault",
			client,
			initialize,
			haveLocalHistory: () => transcript.length > 0,
			// As ChatPanel wires it: `agent.clearError`.
			onAttemptStart: () => {
				banner.error = null;
			},
			onLoaded: (r) => {
				liveSession.sessionId = r.sessionId;
			},
			setIgnoreUpdates: () => {},
			storedEngine: opts.storedEngine,
		}),
	);

	const hook = renderHook(() => {
		const agentMessages = useAgentMessages(
			{ sendPrompt: wire } as unknown as AMParams[0],
			{
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
			deepMock({ saveSessionLocally: vi.fn(async () => {}) }) as CAParams[2],
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
						const step = take(forkScript, "ok");
						if (step.wait) await step.wait;
						if (step.value === "fail") {
							return { ok: false, error: new Error("fork failed") };
						}
						liveSession.sessionId = "branch-1";
						return { ok: true, sessionId: "branch-1", lossy: true };
					}
				: undefined,
			acquireNewSession,
			loadExistingSession,
			// As ChatPanel wires it: rebind the record, then arm the carry-over.
			onSessionFallback: (reason, sid) => {
				fallbackSpy(reason, sid);
				actions.armFallbackCarryOver(reason);
			},
			onReset: actions.clearFallbackCarryOver,
			sendPrompt: vi.fn(),
			debounceMs: 0,
		});
		continuesRef.current = lazy.continuesExistingSession;
		return { lazy, actions };
	});

	const lazy = () => hook.result.current.lazy;

	async function settle() {
		await act(async () => {
			for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
		});
	}

	/** Click send; the acquisition runs and ends in `ready` or `error`. */
	async function clickSend(text: string) {
		await act(async () => {
			lazy().onSendClick(text);
		});
		await settle();
	}

	/** Send as ChatPanel does: acquire, then the connect-flush sends. */
	async function send(text: string) {
		await clickSend(text);
		await waitFor(() => expect(lazy().state).toBe("ready"));
		hook.rerender();
		await act(async () => {
			await hook.result.current.actions.handleSendMessage(text);
		});
	}

	function sent(n: number): string {
		return wire.mock.calls[n][1].map(textOf).join("\n\n");
	}

	/** The session id ChatPanel hands to tab persistence (ChatPanel ~L2405). */
	function persistedId(restoredFromDisk: string | null) {
		return resolveSessionIdForSave(
			lazy().sessionId,
			keptIdForSave(lazy().keptSessionId, restoredFromDisk, transcript.length > 0),
			transcript.length > 0,
		);
	}

	return {
		hook,
		lazy,
		wire,
		send,
		clickSend,
		sent,
		settle,
		persistedId,
		client,
		initialize,
		acquireNewSession,
		loadExistingSession,
		fallbackSpy,
		banner,
	};
}

/** Instruction, then transcript, then the user's text, each once. */
function expectFallbackFirstSend(text: string, userText: string) {
	const i = text.indexOf(INSTRUCTION);
	const t = text.indexOf(TRANSCRIPT);
	const u = text.lastIndexOf(userText);
	expect(i).toBeGreaterThanOrEqual(0);
	expect(t).toBeGreaterThan(i);
	expect(u).toBeGreaterThan(t);
	expect(text.split(INSTRUCTION).length - 1).toBe(1);
	expect(text.split(TRANSCRIPT).length - 1).toBe(1);
}

/** The agent can't start on the first attempt: both launches fail. */
const AGENT_DOWN_ONCE = {
	initialize: ["fail"] as Step<Outcome>[],
	newSession: ["fail"] as Step<Outcome>[],
};

// ---------------------------------------------------------------------------
// 1. The retry after a double failure keeps the fallback
// ---------------------------------------------------------------------------

describe("I280 — the retry after a failed fallback session keeps the fallback", () => {
	it("agent down once, then the session is gone: the retry's first prompt is instruction, transcript, user text", async () => {
		const tab = mountTab({
			restoredSessionId: "sess-x",
			initialize: ["fail", "ok"],
			load: ["fail"],
			newSession: ["fail", "ok"],
		});
		await tab.clickSend(Q);
		expect(tab.lazy().state).toBe("error");
		expect(tab.fallbackSpy).not.toHaveBeenCalled();

		await tab.send(Q);
		expect(tab.wire.mock.calls[0][0]).toBe("new-1");
		expectFallbackFirstSend(tab.sent(0), Q);
		expect(tab.fallbackSpy).toHaveBeenCalledTimes(1);
		expect(tab.fallbackSpy).toHaveBeenCalledWith("unavailable", "new-1");
		// The notice and its reason are right once the tab is ready.
		expect(tab.lazy().isFallbackRecovery).toBe(true);
		expect(tab.lazy().fallbackReason).toBe("unavailable");

		await act(async () => {
			await tab.hook.result.current.actions.handleSendMessage("And doubled?");
		});
		expect(tab.sent(1)).not.toContain(INSTRUCTION);
		expect(tab.sent(1)).not.toContain(TRANSCRIPT);
	});

	it("session gone and new session fails: the retry loads again, then falls back with the transcript", async () => {
		const tab = mountTab({
			restoredSessionId: "sess-x",
			load: ["fail", "fail"],
			newSession: ["fail", "ok"],
		});
		await tab.clickSend(Q);
		expect(tab.lazy().state).toBe("error");

		await tab.send(Q);
		expect(tab.client.loadSession).toHaveBeenCalledTimes(2);
		expect(vi.mocked(tab.client.loadSession).mock.calls[1][0]).toBe("sess-x");
		expectFallbackFirstSend(tab.sent(0), Q);
	});

	it("engine change (V3 chat on V2): the retry falls back with the transcript and never sends the id", async () => {
		const tab = mountTab({
			restoredSessionId: "v3-sess",
			storedEngine: "v3",
			running: "v2",
			newSession: ["fail", "ok"],
		});
		await tab.clickSend(Q);
		expect(tab.lazy().state).toBe("error");

		await tab.send(Q);
		expect(tab.lazy().fallbackReason).toBe("engine-changed");
		expect(tab.fallbackSpy).toHaveBeenCalledWith("engine-changed", "new-1");
		expect(tab.client.loadSession).not.toHaveBeenCalled();
		expectFallbackFirstSend(tab.sent(0), Q);
	});

	it("empty load (I264) on both attempts: the retry falls back with the transcript", async () => {
		const tab = mountTab({
			restoredSessionId: "v3-seeded",
			storedEngine: "v3",
			running: "v3",
			load: ["empty", "empty"],
			newSession: ["fail", "ok"],
		});
		await tab.clickSend(Q);
		await tab.send(Q);
		expectFallbackFirstSend(tab.sent(0), Q);
	});

	it("three failures, then success: exactly one fallback report", async () => {
		const tab = mountTab({
			restoredSessionId: "sess-x",
			initialize: ["fail", "fail", "fail", "ok"],
			load: ["fail"],
			newSession: ["fail", "fail", "fail", "ok"],
		});
		for (let i = 0; i < 3; i++) {
			await tab.clickSend(Q);
			expect(tab.lazy().state).toBe("error");
			// After each failure: notice off, nothing armed, id kept.
			expect(tab.lazy().isFallbackRecovery).toBe(false);
			expect(tab.lazy().keptSessionId).toBe("sess-x");
			expect(tab.fallbackSpy).not.toHaveBeenCalled();
		}
		await tab.send(Q);
		expect(tab.fallbackSpy).toHaveBeenCalledTimes(1);
		expectFallbackFirstSend(tab.sent(0), Q);
	});
});

// ---------------------------------------------------------------------------
// 2. A retry whose load now works recovers the real session
// ---------------------------------------------------------------------------

describe("I280 — a retry whose load now works recovers the real session", () => {
	it("by send: the restored session binds, with no carry-over, instruction or notice", async () => {
		const tab = mountTab({
			restoredSessionId: "sess-x",
			...AGENT_DOWN_ONCE,
			load: ["ok"],
		});
		await tab.clickSend(Q);
		await tab.send(Q);
		expect(tab.wire.mock.calls[0][0]).toBe("sess-x");
		expect(tab.sent(0)).not.toContain(TRANSCRIPT);
		expect(tab.sent(0)).not.toContain(INSTRUCTION);
		expect(tab.lazy().isFallbackRecovery).toBe(false);
		expect(tab.fallbackSpy).not.toHaveBeenCalled();
	});

	it("by typing: a keystroke in error reloads the restored session", async () => {
		const tab = mountTab({
			restoredSessionId: "sess-x",
			...AGENT_DOWN_ONCE,
			load: ["ok"],
		});
		await tab.clickSend(Q);
		expect(tab.lazy().state).toBe("error");
		await act(async () => {
			tab.lazy().onComposerChange("W");
		});
		await tab.settle();
		expect(tab.lazy().state).toBe("ready");
		expect(tab.lazy().sessionId).toBe("sess-x");
		expect(tab.acquireNewSession).toHaveBeenCalledTimes(1);
	});

	it("by the I72 recover click on a fileless tab: it calls load, not a new session", async () => {
		const tab = mountTab({
			restoredSessionId: "sess-x",
			transcript: [],
			...AGENT_DOWN_ONCE,
			load: ["ok"],
		});
		await act(async () => {
			tab.lazy().recoverHistory();
		});
		await tab.settle();
		expect(tab.lazy().state).toBe("error");
		await act(async () => {
			tab.lazy().recoverHistory();
		});
		await tab.settle();
		expect(tab.lazy().sessionId).toBe("sess-x");
		expect(tab.loadExistingSession).toHaveBeenCalledTimes(2);
		expect(tab.acquireNewSession).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// 3. What the tab keeps and shows after the double failure
// ---------------------------------------------------------------------------

describe("I280 — after the double failure", () => {
	it("restored tab: no notice, still continues its session, and persists the restored id", async () => {
		const tab = mountTab({ restoredSessionId: "sess-x", ...AGENT_DOWN_ONCE });
		await tab.clickSend(Q);
		expect(tab.lazy().state).toBe("error");
		expect(tab.lazy().isFallbackRecovery).toBe(false);
		expect(tab.lazy().fallbackReason).toBeNull();
		expect(tab.lazy().keptSessionId).toBe("sess-x");
		expect(tab.lazy().continuesExistingSession()).toBe(true);
		expect(tab.persistedId("sess-x")).toBe("sess-x");
	});

	it("released tab: the reconnect's double failure still persists the released id", async () => {
		const tab = mountTab({
			restoredSessionId: null,
			newSession: ["ok", "fail"],
			initialize: ["fail"],
		});
		await act(async () => {
			await tab.lazy().acquireNow();
		});
		expect(tab.lazy().sessionId).toBe("new-1");
		await act(async () => {
			tab.lazy().release();
		});
		expect(tab.lazy().state).toBe("released");

		await tab.clickSend(Q);
		expect(tab.lazy().state).toBe("error");
		expect(tab.lazy().keptSessionId).toBe("new-1");
		expect(tab.persistedId(null)).toBe("new-1");
	});

	it("the notice stays off while the retry is connecting, and rises at ready", async () => {
		const held = gate();
		const tab = mountTab({
			restoredSessionId: "sess-x",
			initialize: ["fail", "ok"],
			load: ["fail"],
			newSession: ["fail", { after: held.promise, then: "ok" }],
		});
		await tab.clickSend(Q);
		await act(async () => {
			tab.lazy().onSendClick(Q);
		});
		await tab.settle();
		expect(tab.lazy().state).toBe("connecting");
		expect(tab.lazy().isFallbackRecovery).toBe(false);
		// The retry ended the earlier failure: no stale banner while connecting.
		expect(tab.banner.error).toBeNull();

		await act(async () => {
			held.open();
		});
		await tab.settle();
		expect(tab.lazy().state).toBe("ready");
		expect(tab.lazy().isFallbackRecovery).toBe(true);
	});

	it("the error banner clears when the retry starts and returns if the agent still can't start", async () => {
		const held = gate();
		const tab = mountTab({
			restoredSessionId: "sess-x",
			initialize: ["fail", { after: held.promise, then: "fail" }],
			newSession: ["fail", "fail"],
		});
		await tab.clickSend(Q);
		expect(tab.banner.error).toBe("Session Creation Failed");

		await act(async () => {
			tab.lazy().onSendClick(Q);
		});
		await tab.settle();
		expect(tab.lazy().state).toBe("connecting");
		expect(tab.banner.error).toBeNull();

		await act(async () => {
			held.open();
		});
		await tab.settle();
		expect(tab.lazy().state).toBe("error");
		expect(tab.banner.error).toBe("Session Creation Failed");
	});

	it("New chat after the double failure: a plain new chat, nothing armed", async () => {
		const tab = mountTab({ restoredSessionId: "sess-x", ...AGENT_DOWN_ONCE });
		await tab.clickSend(Q);
		await act(async () => {
			tab.lazy().reset();
		});
		expect(tab.lazy().keptSessionId).toBeNull();
		await tab.send("Hello");
		expect(tab.loadExistingSession).toHaveBeenCalledTimes(1);
		expect(tab.fallbackSpy).not.toHaveBeenCalled();
		expect(tab.sent(0)).not.toContain(TRANSCRIPT);
		expect(tab.lazy().isFallbackRecovery).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 4. Resets during each await bind nothing and arm nothing
// ---------------------------------------------------------------------------

describe("I280 — a reset during the acquisition", () => {
	it("during the first load, which then fails: no notice on the new chat", async () => {
		const held = gate();
		const tab = mountTab({
			restoredSessionId: "sess-x",
			load: [{ after: held.promise, then: "fail" }],
		});
		await act(async () => {
			tab.lazy().onSendClick(Q);
		});
		await act(async () => {
			tab.lazy().reset();
		});
		await act(async () => {
			held.open();
		});
		await tab.settle();
		expect(tab.lazy().isFallbackRecovery).toBe(false);
		expect(tab.lazy().fallbackReason).toBeNull();
		expect(tab.lazy().sessionId).toBeNull();
		expect(tab.fallbackSpy).not.toHaveBeenCalled();
	});

	it("during a lossy fork: no notice on the new chat", async () => {
		const held = gate();
		const tab = mountTab({
			forkFromSessionId: "orig",
			fork: [{ after: held.promise, then: "ok" }],
		});
		await act(async () => {
			tab.lazy().onSendClick(Q);
		});
		await act(async () => {
			tab.lazy().reset();
		});
		await act(async () => {
			held.open();
		});
		await tab.settle();
		expect(tab.lazy().isFallbackRecovery).toBe(false);
		expect(tab.lazy().sessionId).toBeNull();
		expect(tab.fallbackSpy).not.toHaveBeenCalled();
	});

	it("during the retry's load: nothing binds or is armed", async () => {
		const held = gate();
		const tab = mountTab({
			restoredSessionId: "sess-x",
			initialize: ["fail", "ok"],
			load: [{ after: held.promise, then: "ok" }],
			newSession: ["fail"],
		});
		await tab.clickSend(Q);
		await act(async () => {
			tab.lazy().onSendClick(Q);
		});
		await act(async () => {
			tab.lazy().reset();
		});
		await act(async () => {
			held.open();
		});
		await tab.settle();
		expect(tab.lazy().sessionId).toBeNull();
		expect(tab.lazy().keptSessionId).toBeNull();
		expect(tab.fallbackSpy).not.toHaveBeenCalled();
	});

	it("during the retry's new session: the restored id is dropped and nothing is armed", async () => {
		const held = gate();
		const tab = mountTab({
			restoredSessionId: "sess-x",
			initialize: ["fail", "ok"],
			load: ["fail"],
			newSession: ["fail", { after: held.promise, then: "ok" }],
		});
		await tab.clickSend(Q);
		await act(async () => {
			tab.lazy().onSendClick(Q);
		});
		await tab.settle();
		await act(async () => {
			tab.lazy().reset();
		});
		await act(async () => {
			held.open();
		});
		await tab.settle();
		expect(tab.lazy().sessionId).toBeNull();
		expect(tab.lazy().keptSessionId).toBeNull();
		expect(tab.lazy().isFallbackRecovery).toBe(false);
		expect(tab.fallbackSpy).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// 5. Typing in `error` retries once per failed acquisition
// ---------------------------------------------------------------------------

describe("I280 — typing retries", () => {
	it("one load and one new-session attempt per failed acquisition, no overlap, then nothing once ready", async () => {
		const held = gate();
		const tab = mountTab({
			restoredSessionId: "sess-x",
			initialize: ["fail", { after: held.promise, then: "fail" }, "ok"],
			load: ["fail"],
			newSession: ["fail", "fail", "ok"],
		});
		await tab.clickSend(Q);
		expect(tab.lazy().state).toBe("error");

		// A burst while the second attempt is in flight starts only one.
		await act(async () => {
			tab.lazy().onComposerChange("W");
		});
		await tab.settle();
		expect(tab.lazy().state).toBe("connecting");
		await act(async () => {
			tab.lazy().onComposerChange("Wh");
			tab.lazy().onComposerChange("Wha");
		});
		await tab.settle();
		await act(async () => {
			held.open();
		});
		await tab.settle();
		expect(tab.lazy().state).toBe("error");
		expect(tab.loadExistingSession).toHaveBeenCalledTimes(2);
		expect(tab.acquireNewSession).toHaveBeenCalledTimes(2);

		await act(async () => {
			tab.lazy().onComposerChange("What");
		});
		await tab.settle();
		expect(tab.lazy().state).toBe("ready");
		expect(tab.loadExistingSession).toHaveBeenCalledTimes(3);
		expect(tab.acquireNewSession).toHaveBeenCalledTimes(3);
		expect(tab.fallbackSpy).toHaveBeenCalledTimes(1);

		await act(async () => {
			tab.lazy().onComposerChange("What n");
		});
		await tab.settle();
		expect(tab.loadExistingSession).toHaveBeenCalledTimes(3);

		// The typed message, sent now, carries the armed fallback.
		tab.hook.rerender();
		await act(async () => {
			await tab.hook.result.current.actions.handleSendMessage(Q);
		});
		expectFallbackFirstSend(tab.sent(0), Q);
	});
});
