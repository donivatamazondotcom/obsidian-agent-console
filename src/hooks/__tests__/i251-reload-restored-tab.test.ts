/**
 * I251 — reproduce-first: Reload on a chat restored from Session history that
 * hasn't connected must restart the agent and connect it on the restored
 * session.
 *
 * Observed (11/09, `main` @ 649eb18, studio): restore "Launch check" from
 * Session history; the tab shows the moon. Click Reload. "Reloading session…"
 * appears and nothing else happens: no model/mode dropdowns, "Send to
 * connect" stays. Sending a message does connect.
 *
 * Seam (R2): the real hooks on this path — `useLazySession` (the single
 * acquisition owner), `useChatActions.handleReload` (the header ↻ and the
 * reload-session command) and `useQueueOrchestration` — wired the way
 * ChatPanel wires them: the owner's `reloadNow` / `acquireNow` behind
 * `lazyReloadNowRef` / `lazyAcquireNowRef`, and ChatPanel's connect-flush
 * effect through the production `decideConnectFlush`. Faked (R4): the agent
 * port handed to useChatActions, the ChatPanel acquisition callbacks handed
 * to useLazySession, and Obsidian's `Notice`. The fake agent tracks one
 * process: `restartForReload` kills it, and the fake load / new session
 * re-initialize first when it's gone, like `reconnectExistingSession` does.
 * Assertions (R3): the call order the agent sees, the lazy state and bound
 * id the tab ends with, delivered queued sends, and the notices. Literals
 * only (R5).
 *
 * Spec: [[I251 Reload does nothing on a chat restored from history]].
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { useChatActions } from "../useChatActions";
import { useLazySession } from "../useLazySession";
import { useQueueOrchestration } from "../useQueueOrchestration";
import { decideConnectFlush } from "../../services/message-queue-logic";
import type { ChatMessage } from "../../types/chat";

const { noticeMessages } = vi.hoisted(() => ({
	noticeMessages: [] as string[],
}));
vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		Notice: class {
			constructor(message: string) {
				noticeMessages.push(message);
			}
		},
	};
});

beforeEach(() => {
	noticeMessages.length = 0;
});

const RELOADING = "[Agent Console] Reloading session…";
const RELOADED = "[Agent Console] Session reloaded";
const FAILED = "[Agent Console] Failed to reload session";

type Params = Parameters<typeof useChatActions>;

/** Recursive proxy: any unspecified property access returns a callable mock. */
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

const HISTORY: ChatMessage[] = [
	{
		id: "m1",
		role: "user",
		content: [{ type: "text", text: "launch check" }],
		timestamp: new Date(0),
	},
];

function deferred() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

interface SetupOpts {
	restoredSessionId: string | null;
	/** A tab opened from Session history as a fork of this id. */
	forkFromSessionId?: string;
	/** "fails": the load fails; "rejected": the agent rejects the id. */
	load?: "ok" | "fails" | "rejected";
	/** The new-session fallback fails too (the agent can't be reached). */
	newSession?: "ok" | "fails";
	hasLocalRecord?: boolean;
	haveLocalHistory?: boolean;
	/** Hold the restart until the test releases it. */
	holdTeardown?: boolean;
	/** The restart itself throws. */
	teardownThrows?: boolean;
	/** Hold the load until the test releases it. */
	holdLoad?: boolean;
	debounceMs?: number;
}

function setup(opts: SetupOpts) {
	// One agent process, already running (eager initialize on an active tab).
	let initialized = true;
	const calls: string[] = [];
	let newCount = 0;
	const teardownGate = deferred();
	const loadGate = deferred();
	const stillCurrentSeen: boolean[] = [];

	const ensureInit = () => {
		if (!initialized) {
			calls.push("initialize");
			initialized = true;
		}
	};
	const loadExistingSession = vi.fn(async (sid: string) => {
		ensureInit();
		calls.push(`load:${sid}`);
		if (opts.holdLoad) await loadGate.promise;
		if (opts.load === "fails") {
			return { ok: false as const, error: new Error("load failed") };
		}
		if (opts.load === "rejected") {
			return {
				ok: false as const,
				error: new Error("Session not found"),
				failure: "rejected" as const,
			};
		}
		return { ok: true as const, sessionId: sid };
	});
	const acquireNewSession = vi.fn(async () => {
		ensureInit();
		calls.push("new");
		if (opts.newSession === "fails") {
			return { ok: false as const, error: new Error("spawn failed") };
		}
		newCount += 1;
		return { ok: true as const, sessionId: `fresh-${newCount}` };
	});
	const forkExistingSession = vi.fn(async (sid: string) => {
		ensureInit();
		calls.push(`fork:${sid}`);
		return { ok: true as const, sessionId: "branch-1" };
	});
	const restartForReload = vi.fn(async (stillCurrent: () => boolean) => {
		calls.push("restart");
		if (opts.teardownThrows) throw new Error("disconnect failed");
		if (opts.holdTeardown) await teardownGate.promise;
		stillCurrentSeen.push(stillCurrent());
		if (!stillCurrent()) return;
		initialized = false;
	});
	// The agent's own bound-session reload: must not be how an unbound tab
	// connects (it has no session to resume).
	const reloadSession = vi
		.fn()
		.mockResolvedValue({ resumed: true, sessionId: "should-not-run" });
	const closeSession = vi.fn(async () => {
		calls.push("close");
		initialized = false;
	});

	const acquireRef: Params[12] = { current: null };
	const reloadRef = { current: null } as NonNullable<Params[15]>;
	const delivered: string[] = [];

	const hook = renderHook(() => {
		const lazy = useLazySession({
			restoredSessionId: opts.restoredSessionId,
			forkFromSessionId: opts.forkFromSessionId ?? null,
			forkExistingSession,
			acquireNewSession,
			loadExistingSession,
			sendPrompt: vi.fn(async () => {}),
			hasLocalRecord: () => opts.hasLocalRecord ?? true,
			haveLocalHistory: () => opts.haveLocalHistory ?? true,
			debounceMs: opts.debounceMs,
		});
		// ChatPanel assigns the owner's entry points to the refs each render.
		acquireRef.current = lazy.acquireNow;
		reloadRef.current = lazy.reloadNow;

		const queue = useQueueOrchestration({
			acquire: () => lazy.onSendClick(""),
			flushDispatch: (m) => delivered.push(m.content),
			clearComposer: () => {},
			cancelTurn: () => {},
		});
		// ChatPanel's connect-flush effect, through the production resolver.
		const prevLazyStateRef = useRef<string>(lazy.state);
		const awaitingRef = useRef(false);
		useEffect(() => {
			const decision = decideConnectFlush({
				prevState: prevLazyStateRef.current,
				state: lazy.state,
				hasSessionId: lazy.sessionId !== null,
				awaitingSessionId: awaitingRef.current,
			});
			prevLazyStateRef.current = lazy.state;
			awaitingRef.current = decision.awaitingSessionId;
			if (decision.dispatchAcquisitionComplete) {
				queue.dispatch({ type: "acquisitionComplete", hasSessionId: true });
			}
			if (decision.dispatchAcquisitionFailed) {
				queue.dispatch({ type: "acquisitionFailed" });
			}
		}, [lazy.state, lazy.sessionId, queue.dispatch]);

		const actions = useChatActions(
			deepMock() as Params[0],
			deepMock({
				isSending: false,
				cancelOperation: vi.fn().mockResolvedValue(undefined),
				clearMessages: vi.fn(),
				closeSession,
				reloadSession,
				restartForReload,
			}) as Params[1],
			deepMock({ invalidateCache: vi.fn() }) as Params[2],
			deepMock() as Params[3],
			{ sessionId: null, agentId: "test-agent" } as unknown as Params[4],
			[],
			deepMock() as Params[6],
			"",
			{ notes: [], add: vi.fn() } as unknown as Params[8],
			null,
			null,
			false,
			acquireRef,
			"",
			"",
			reloadRef,
		);
		return { lazy, actions, queue };
	});

	return {
		opts,
		result: hook.result,
		calls,
		stillCurrentSeen,
		loadExistingSession,
		acquireNewSession,
		reloadSession,
		restartForReload,
		closeSession,
		delivered,
		releaseTeardown: () => teardownGate.resolve(),
		releaseLoad: () => loadGate.resolve(),
	};
}

const settle = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("I251: Reload on a tab with no bound session", () => {
	it("restored from history: restarts the agent, then loads the restored session", async () => {
		const t = setup({ restoredSessionId: "launch-check" });

		// Precondition: kept id, no bound session, not connected.
		expect(t.result.current.lazy.state).toBe("idle");
		expect(t.result.current.lazy.sessionId).toBeNull();
		expect(t.result.current.lazy.keptSessionId).toBe("launch-check");

		await act(async () => {
			await t.result.current.actions.handleReload(false);
		});

		expect(t.calls).toEqual(["restart", "initialize", "load:launch-check"]);
		expect(t.reloadSession).not.toHaveBeenCalled();
		expect(t.result.current.lazy.state).toBe("ready");
		expect(t.result.current.lazy.sessionId).toBe("launch-check");
		expect(noticeMessages).toEqual([RELOADING, RELOADED]);
	});

	it("an agent that can't be reached says so and doesn't claim a reload", async () => {
		const t = setup({
			restoredSessionId: "launch-check",
			load: "fails",
			newSession: "fails",
		});

		await act(async () => {
			await t.result.current.actions.handleReload(false);
		});

		expect(t.result.current.lazy.state).toBe("error");
		expect(t.result.current.lazy.sessionId).toBeNull();
		expect(noticeMessages).toEqual([RELOADING, FAILED]);
	});

	it("after a failed connect, a send retries on the restored id", async () => {
		const t = setup({
			restoredSessionId: "launch-check",
			load: "fails",
			newSession: "fails",
		});
		await act(async () => {
			await t.result.current.actions.handleReload(false);
		});
		expect(t.result.current.lazy.keptSessionId).toBe("launch-check");

		// The agent is reachable again; the user sends.
		t.opts.load = "ok";
		await act(async () => {
			t.result.current.lazy.onSendClick("hi");
			await settle();
		});
		expect(t.loadExistingSession.mock.calls).toEqual([
			["launch-check"],
			["launch-check"],
		]);
		expect(t.result.current.lazy.sessionId).toBe("launch-check");
		expect(t.result.current.lazy.state).toBe("ready");
	});

	it("a restart that throws: error state, failure toast, and a send retries", async () => {
		const t = setup({ restoredSessionId: "launch-check", teardownThrows: true });

		await act(async () => {
			await t.result.current.actions.handleReload(false);
		});

		expect(t.loadExistingSession).not.toHaveBeenCalled();
		expect(t.result.current.lazy.state).toBe("error");
		expect(t.result.current.lazy.isAcquisitionPending()).toBe(false);
		expect(noticeMessages).toEqual([RELOADING, FAILED]);

		await act(async () => {
			t.result.current.lazy.onSendClick("hi");
			await settle();
		});
		expect(t.loadExistingSession.mock.calls).toEqual([["launch-check"]]);
		expect(t.result.current.lazy.state).toBe("ready");
	});

	it("Reload from the error state after a failed first connect retries", async () => {
		const t = setup({
			restoredSessionId: "launch-check",
			load: "fails",
			newSession: "fails",
		});
		await act(async () => {
			t.result.current.lazy.onSendClick("hi");
			await settle();
		});
		expect(t.result.current.lazy.state).toBe("error");
		t.opts.load = "ok";
		t.calls.length = 0;
		noticeMessages.length = 0;

		await act(async () => {
			await t.result.current.actions.handleReload(false);
		});

		expect(t.calls).toEqual(["restart", "initialize", "load:launch-check"]);
		expect(t.result.current.lazy.state).toBe("ready");
		expect(noticeMessages).toEqual([RELOADING, RELOADED]);
	});

	it("restored id the agent rejected with nothing to carry over: the gone state, and a failure toast", async () => {
		const t = setup({
			restoredSessionId: "launch-check",
			load: "rejected",
			hasLocalRecord: false,
			haveLocalHistory: false,
		});

		await act(async () => {
			await t.result.current.actions.handleReload(false);
		});

		expect(t.acquireNewSession).not.toHaveBeenCalled();
		expect(t.result.current.lazy.sessionGone).toBe(true);
		expect(noticeMessages).toEqual([RELOADING, FAILED]);
	});

	it("restored load fails but a new session starts: no toast (the in-chat notice covers it)", async () => {
		const t = setup({ restoredSessionId: "launch-check", load: "fails" });

		await act(async () => {
			await t.result.current.actions.handleReload(false);
		});

		expect(t.calls).toEqual([
			"restart",
			"initialize",
			"load:launch-check",
			"new",
		]);
		expect(t.result.current.lazy.sessionId).toBe("fresh-1");
		expect(t.result.current.lazy.isFallbackRecovery).toBe(true);
		expect(noticeMessages).toEqual([RELOADING]);
	});

	it("fresh tab with no session: restarts and starts a new session", async () => {
		const t = setup({ restoredSessionId: null });

		await act(async () => {
			await t.result.current.actions.handleReload(false);
		});

		expect(t.calls).toEqual(["restart", "initialize", "new"]);
		expect(t.result.current.lazy.sessionId).toBe("fresh-1");
		expect(noticeMessages).toEqual([RELOADING, RELOADED]);
	});

	it("released tab: reconnects on the kept id and confirms", async () => {
		const t = setup({ restoredSessionId: null });
		// First send binds fresh-1; idle release keeps it.
		await act(async () => {
			t.result.current.lazy.onSendClick("hi");
			await settle();
		});
		expect(t.result.current.lazy.sessionId).toBe("fresh-1");
		act(() => {
			expect(t.result.current.lazy.release()).toBe(true);
		});
		expect(t.result.current.lazy.state).toBe("released");
		t.calls.length = 0;

		await act(async () => {
			await t.result.current.actions.handleReload(false);
		});

		expect(t.calls).toEqual(["restart", "initialize", "load:fresh-1"]);
		expect(t.result.current.lazy.state).toBe("ready");
		expect(t.result.current.lazy.sessionId).toBe("fresh-1");
		expect(noticeMessages).toEqual([RELOADING, RELOADED]);
	});

	it("while a connect is already running: nothing starts and no notice shows", async () => {
		const t = setup({ restoredSessionId: "launch-check", holdLoad: true });
		act(() => {
			t.result.current.lazy.onSendClick("hi");
		});
		expect(t.result.current.lazy.state).toBe("connecting");

		await act(async () => {
			await t.result.current.actions.handleReload(false);
		});
		expect(t.restartForReload).not.toHaveBeenCalled();
		expect(noticeMessages).toEqual([]);

		await act(async () => {
			t.releaseLoad();
			await settle();
		});
		expect(t.loadExistingSession).toHaveBeenCalledTimes(1);
		expect(t.result.current.lazy.state).toBe("ready");
	});

	it("a send during the restart waits and goes out once connected", async () => {
		const t = setup({ restoredSessionId: "launch-check", holdTeardown: true });

		let reload: Promise<void> = Promise.resolve();
		act(() => {
			reload = t.result.current.actions.handleReload(false);
		});
		await act(settle);
		expect(t.result.current.lazy.state).toBe("connecting");

		act(() => {
			t.result.current.queue.dispatch({
				type: "sendWhilePreReady",
				message: { content: "hello after reload" },
			});
		});
		expect(t.result.current.queue.isQueued).toBe(true);

		await act(async () => {
			t.releaseTeardown();
			await reload;
			await settle();
		});

		expect(t.loadExistingSession).toHaveBeenCalledTimes(1);
		expect(t.delivered).toEqual(["hello after reload"]);
		expect(t.result.current.queue.isQueued).toBe(false);
	});

	it("New chat during the restart: no load, no new session, no notice after", async () => {
		const t = setup({ restoredSessionId: "launch-check", holdTeardown: true });

		let reload: Promise<void> = Promise.resolve();
		act(() => {
			reload = t.result.current.actions.handleReload(false);
		});
		await act(settle);
		act(() => {
			t.result.current.lazy.reset();
		});
		await act(async () => {
			t.releaseTeardown();
			await reload;
			await settle();
		});

		// The restart saw the reset and skipped killing the new chat's process.
		expect(t.stillCurrentSeen).toEqual([false]);
		expect(t.calls).toEqual(["restart"]);
		expect(t.result.current.lazy.state).toBe("idle");
		expect(noticeMessages).toEqual([RELOADING]);
	});

	it("typing just before Reload doesn't start a second acquisition", async () => {
		const t = setup({ restoredSessionId: "launch-check", debounceMs: 5 });
		act(() => {
			t.result.current.lazy.onComposerChange("h");
		});
		await act(async () => {
			await t.result.current.actions.handleReload(false);
			await new Promise((r) => window.setTimeout(r, 20));
		});
		expect(t.loadExistingSession).toHaveBeenCalledTimes(1);
		expect(t.result.current.lazy.state).toBe("ready");
	});

	it("fork-pending tab: restarts, then forks (the branch, not a plain load)", async () => {
		const t = setup({ restoredSessionId: null, forkFromSessionId: "origin-1" });

		await act(async () => {
			await t.result.current.actions.handleReload(false);
		});

		expect(t.calls).toEqual(["restart", "initialize", "fork:origin-1"]);
		expect(t.result.current.lazy.sessionId).toBe("branch-1");
		expect(noticeMessages).toEqual([RELOADING, RELOADED]);
	});

	it("hard reload on a restored tab still starts a fresh session", async () => {
		const t = setup({ restoredSessionId: "launch-check" });

		await act(async () => {
			await t.result.current.actions.handleReload(true);
		});

		expect(t.calls).toEqual(["close", "initialize", "new"]);
		expect(t.result.current.lazy.sessionId).toBe("fresh-1");
		expect(t.result.current.lazy.keptSessionId).toBeNull();
	});
});

describe("I251: a reset during a bound reload reports nothing", () => {
	async function boundTab() {
		const t = setup({ restoredSessionId: null });
		await act(async () => {
			t.result.current.lazy.onSendClick("hi");
			await settle();
		});
		expect(t.result.current.lazy.sessionId).toBe("fresh-1");
		return t;
	}

	it("a reload that resolves after New chat shows no 'reloaded'", async () => {
		const t = await boundTab();
		let finish: () => void = () => {};
		t.reloadSession.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = () => resolve({ resumed: true, sessionId: "fresh-1" });
				}),
		);
		let reload: Promise<void> = Promise.resolve();
		act(() => {
			reload = t.result.current.actions.handleReload(false);
		});
		await act(settle);
		act(() => {
			t.result.current.lazy.reset();
		});
		await act(async () => {
			finish();
			await reload;
		});
		expect(noticeMessages).toEqual([RELOADING]);
	});

	it("a reload that throws after New chat shows no failure", async () => {
		const t = await boundTab();
		let fail: () => void = () => {};
		t.reloadSession.mockImplementation(
			() =>
				new Promise((_resolve, reject) => {
					fail = () => reject(new Error("disconnect failed"));
				}),
		);
		let reload: Promise<void> = Promise.resolve();
		act(() => {
			reload = t.result.current.actions.handleReload(false);
		});
		await act(settle);
		act(() => {
			t.result.current.lazy.reset();
		});
		await act(async () => {
			fail();
			await reload;
		});
		expect(noticeMessages).toEqual([RELOADING]);
	});
});
