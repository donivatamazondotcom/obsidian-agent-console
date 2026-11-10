/**
 * I318 — reproduce-first: after a Reload fails on a tab that was connected, a
 * send must connect again and the message must go out once.
 *
 * Observed (from code, `main` @ 750f1c1): the failed bound reload leaves the
 * tab in `error` with the old session id still bound. A send in `error` is a
 * pre-ready send: the queue holds it and calls `onSendClick("")`, which takes
 * the bound-id branch and starts nothing, so the message is held forever.
 *
 * Seam (R2): the real hooks on this path, wired the way ChatPanel wires them —
 * `useLazySession` (the single acquisition owner), `useChatActions.handleReload`
 * (header ↻ / reload-session command) behind `lazyReloadNowRef`, and
 * `useQueueOrchestration` with ChatPanel's connect-flush effect through the
 * production `decideConnectFlush`. Faked (R4): the agent port handed to
 * useChatActions, the ChatPanel acquisition callbacks handed to
 * useLazySession, and Obsidian's `Notice`. Assertions (R3): the calls the
 * agent sees, the lazy state and bound id, delivered sends, notices.
 * Literals only (R5).
 *
 * Spec: [[I318 A send after a failed reload doesn't retry the connection]].
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { useChatActions } from "../useChatActions";
import { useLazySession } from "../useLazySession";
import { useQueueOrchestration } from "../useQueueOrchestration";
import { decideConnectFlush } from "../../services/message-queue-logic";
import { keptIdForSave } from "../../services/session-helpers";
import { decideKeepSessionId } from "../../resolvers/keep-session-id";
import type { ReloadSessionFlowResult } from "../reloadSessionFlow";

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
const FAILED = "[Agent Console] Failed to reload session";

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

interface SetupOpts {
	/** How the bound reload fails: it throws, or it ends with no session. */
	reloadFailure: "throws" | "no-session";
	/** The retry's load of the old id fails (the new session starts). */
	retryLoad?: "ok" | "fails";
	/** Restored from disk with this id (default: a fresh tab). */
	restoredSessionId?: string | null;
	/** Messages on screen (default true). */
	hasMessages?: boolean;
	/** Hold the bound reload until the test releases it. */
	holdReload?: boolean;
}

const nextTask = () => new Promise<void>((r) => window.setTimeout(r, 0));

function deferred() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

function setup(opts: SetupOpts) {
	// The agent can be reached until the test says otherwise.
	const agent = { reachable: true, initialized: true };
	const calls: string[] = [];
	let newCount = 0;
	const fallbacks: Array<[string, string]> = [];
	const reloadGate = deferred();
	const state = { hasMessages: opts.hasMessages ?? true };

	const ensureInit = () => {
		if (!agent.initialized) {
			if (!agent.reachable) throw new Error("spawn kiro-cli ENOENT");
			calls.push("initialize");
			agent.initialized = true;
		}
	};
	const loadExistingSession = vi.fn(async (sid: string) => {
		// A real connect spans at least one macrotask (process spawn, IPC), so
		// React commits `connecting` before `ready`, as ChatPanel sees it.
		await nextTask();
		try {
			ensureInit();
		} catch (error) {
			// reconnectExistingSession reports a failed initialize this way.
			return {
				ok: false as const,
				error: error as Error,
				failure: "initialize" as const,
			};
		}
		calls.push(`load:${sid}`);
		if (opts.retryLoad === "fails") {
			return { ok: false as const, error: new Error("load failed") };
		}
		return { ok: true as const, sessionId: sid };
	});
	const acquireNewSession = vi.fn(async () => {
		await nextTask();
		try {
			ensureInit();
		} catch (error) {
			return { ok: false as const, error: error as Error };
		}
		calls.push("new");
		newCount += 1;
		return { ok: true as const, sessionId: `fresh-${newCount}` };
	});
	// The agent's bound-session reload: kills the process, then can't start
	// it again because the CLI is gone.
	const reloadSession = vi.fn(async (): Promise<ReloadSessionFlowResult> => {
		calls.push("reload");
		agent.initialized = false;
		if (opts.holdReload) await reloadGate.promise;
		if (opts.reloadFailure === "throws") {
			throw new Error("spawn kiro-cli ENOENT");
		}
		return { resumed: false as const, reason: "resume-failed" as const, sessionId: null };
	});
	const restartForReload = vi.fn(async () => {
		calls.push("restart");
		agent.initialized = false;
	});

	const acquireRef: Params[12] = { current: null };
	const reloadRef = { current: null } as NonNullable<Params[15]>;
	const delivered: string[] = [];

	const hook = renderHook(() => {
		const lazy = useLazySession({
			restoredSessionId: opts.restoredSessionId ?? null,
			acquireNewSession,
			loadExistingSession,
			sendPrompt: vi.fn(async () => {}),
			onSessionFallback: (reason, sid) => fallbacks.push([reason, sid]),
			hasLocalRecord: () => state.hasMessages,
			haveLocalHistory: () => state.hasMessages,
		});
		acquireRef.current = lazy.acquireNow;
		reloadRef.current = lazy.reloadNow;

		const queue = useQueueOrchestration({
			acquire: () => lazy.onSendClick(""),
			flushDispatch: (m) => delivered.push(m.content),
			clearComposer: () => {},
			cancelTurn: () => {},
		});
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
				closeSession: vi.fn(),
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
		agent,
		state,
		releaseReload: () => reloadGate.resolve(),
		reloadSession,
		result: hook.result,
		calls,
		fallbacks,
		delivered,
		loadExistingSession,
		acquireNewSession,
	};
}

const settle = async () => {
	for (let i = 0; i < 6; i++) {
		await nextTask();
		for (let j = 0; j < 5; j++) await Promise.resolve();
	}
};

/** A tab that connected on its first send, then a Reload that fails. */
async function connectThenFailReload(t: ReturnType<typeof setup>) {
	act(() => {
		t.result.current.queue.dispatch({
			type: "sendWhilePreReady",
			message: { content: "first" },
		});
	});
	await act(settle);
	expect(t.result.current.lazy.state).toBe("ready");
	expect(t.result.current.lazy.sessionId).toBe("fresh-1");
	expect(t.delivered).toEqual(["first"]);

	// The agent CLI goes away; the user clicks Reload.
	t.agent.reachable = false;
	t.calls.length = 0;
	await act(async () => {
		await t.result.current.actions.handleReload(false);
	});
	expect(t.result.current.lazy.state).toBe("error");
	expect(noticeMessages).toEqual([RELOADING, FAILED]);
	// The conversation's id is kept for the next connect (and a restart).
	expect(t.result.current.lazy.sessionId).toBeNull();
	expect(t.result.current.lazy.keptSessionId).toBe("fresh-1");
	// The next message continues the conversation.
	expect(t.result.current.lazy.continuesExistingSession()).toBe(true);
}

describe("I318: a send after a failed reload retries the connection", () => {
	for (const reloadFailure of ["throws", "no-session"] as const) {
		it(`reload ${reloadFailure}: a send reconnects on the same session and goes out once`, async () => {
			const t = setup({ reloadFailure });
			await connectThenFailReload(t);

			// The agent is reachable again; the user sends from the error state.
			t.agent.reachable = true;
			t.calls.length = 0;
			act(() => {
				t.result.current.queue.dispatch({
					type: "sendWhilePreReady",
					message: { content: "after the failed reload" },
				});
			});
			await act(settle);

			expect(t.calls).toEqual(["initialize", "load:fresh-1"]);
			expect(t.result.current.lazy.state).toBe("ready");
			expect(t.result.current.lazy.sessionId).toBe("fresh-1");
			expect(t.delivered).toEqual(["first", "after the failed reload"]);
			expect(t.result.current.queue.isQueued).toBe(false);
			expect(t.fallbacks).toEqual([]);
		});
	}

	it("the old session can't be loaded: a new session carries the transcript, sent once", async () => {
		const t = setup({ reloadFailure: "throws", retryLoad: "fails" });
		await connectThenFailReload(t);

		t.agent.reachable = true;
		t.calls.length = 0;
		act(() => {
			t.result.current.queue.dispatch({
				type: "sendWhilePreReady",
				message: { content: "after the failed reload" },
			});
		});
		await act(settle);

		expect(t.calls).toEqual(["initialize", "load:fresh-1", "new"]);
		expect(t.result.current.lazy.sessionId).toBe("fresh-2");
		expect(t.fallbacks).toEqual([["unavailable", "fresh-2"]]);
		expect(t.delivered).toEqual(["first", "after the failed reload"]);
	});

	it("still unreachable: the send stays held; once the agent is back, Edit then Send delivers it once", async () => {
		const t = setup({ reloadFailure: "throws" });
		await connectThenFailReload(t);

		act(() => {
			t.result.current.queue.dispatch({
				type: "sendWhilePreReady",
				message: { content: "retry me" },
			});
		});
		await act(settle);
		expect(t.result.current.lazy.state).toBe("error");
		expect(t.result.current.queue.isQueued).toBe(true);
		expect(t.result.current.lazy.keptSessionId).toBe("fresh-1");
		expect(t.delivered).toEqual(["first"]);

		t.agent.reachable = true;
		act(() => {
			t.result.current.queue.dispatch({ type: "editQueued" });
			t.result.current.queue.dispatch({
				type: "sendWhilePreReady",
				message: { content: "retry me" },
			});
		});
		await act(settle);
		expect(t.result.current.lazy.sessionId).toBe("fresh-1");
		expect(t.delivered).toEqual(["first", "retry me"]);
	});

	for (const retry of ["edit-send", "reload"] as const) {
		it(`a message sent while the failing reload connects is held, then ${retry} delivers it once`, async () => {
			const t = setup({ reloadFailure: "throws", holdReload: true });
			act(() => {
				t.result.current.queue.dispatch({
					type: "sendWhilePreReady",
					message: { content: "first" },
				});
			});
			await act(settle);
			t.agent.reachable = false;

			let reload: Promise<void> = Promise.resolve();
			act(() => {
				reload = t.result.current.actions.handleReload(false);
			});
			await act(settle);
			expect(t.result.current.lazy.state).toBe("connecting");
			// Saved for a restart while the reload runs.
			expect(t.result.current.lazy.keptSessionId).toBe("fresh-1");
			expect(keptIdForSave(t.result.current.lazy.keptSessionId, null, true)).toBe(
				"fresh-1",
			);

			act(() => {
				t.result.current.queue.dispatch({
					type: "sendWhilePreReady",
					message: { content: "during reload" },
				});
			});
			await act(async () => {
				t.releaseReload();
				await reload;
				await settle();
			});
			expect(t.result.current.lazy.state).toBe("error");
			expect(t.result.current.queue.isQueued).toBe(true);
			expect(t.delivered).toEqual(["first"]);

			t.agent.reachable = true;
			t.calls.length = 0;
			let retried: Promise<void> = Promise.resolve();
			act(() => {
				if (retry === "edit-send") {
					t.result.current.queue.dispatch({ type: "editQueued" });
					t.result.current.queue.dispatch({
						type: "sendWhilePreReady",
						message: { content: "during reload" },
					});
				} else {
					retried = t.result.current.actions.handleReload(false);
				}
			});
			await act(async () => {
				await retried;
				await settle();
			});
			expect(t.calls).toEqual(
				retry === "edit-send"
					? ["initialize", "load:fresh-1"]
					: ["restart", "initialize", "load:fresh-1"],
			);
			expect(t.delivered).toEqual(["first", "during reload"]);
			expect(t.result.current.queue.isQueued).toBe(false);
		});
	}

	it("Reload again from the error state reconnects on the same session", async () => {
		const t = setup({ reloadFailure: "throws" });
		await connectThenFailReload(t);

		t.agent.reachable = true;
		t.calls.length = 0;
		noticeMessages.length = 0;
		let reload: Promise<void> = Promise.resolve();
		act(() => {
			reload = t.result.current.actions.handleReload(false);
		});
		await act(async () => {
			await reload;
			await settle();
		});

		expect(t.calls).toEqual(["restart", "initialize", "load:fresh-1"]);
		expect(t.result.current.lazy.state).toBe("ready");
		expect(t.result.current.lazy.sessionId).toBe("fresh-1");
	});

	it("an empty tab whose reload fails starts a plain new chat on the next send", async () => {
		const t = setup({ reloadFailure: "throws", hasMessages: false });
		// Connect the empty tab (as eager acquire does on a fresh tab).
		act(() => {
			t.result.current.lazy.onSendClick("");
		});
		await act(settle);
		expect(t.result.current.lazy.sessionId).toBe("fresh-1");

		t.agent.reachable = false;
		await act(async () => {
			await t.result.current.actions.handleReload(false);
		});
		expect(t.result.current.lazy.state).toBe("error");
		expect(t.result.current.lazy.keptSessionId).toBeNull();
		expect(t.result.current.lazy.continuesExistingSession()).toBe(false);

		t.agent.reachable = true;
		t.calls.length = 0;
		act(() => {
			t.result.current.lazy.onSendClick("");
		});
		await act(settle);
		expect(t.calls).toEqual(["initialize", "new"]);
		expect(t.loadExistingSession).not.toHaveBeenCalled();
		expect(t.result.current.lazy.sessionId).toBe("fresh-2");
	});

	it("a restored tab after a hard reload has nothing to keep: a failed reload and an idle release both drop the id", async () => {
		const t = setup({
			reloadFailure: "throws",
			restoredSessionId: "launch-check",
			hasMessages: false,
		});
		// Hard reload: reset, then a new (empty) session.
		await act(async () => {
			await t.result.current.lazy.acquireNow();
		});
		expect(t.result.current.lazy.sessionId).toBe("fresh-1");
		expect(t.result.current.lazy.continuesExistingSession()).toBe(false);

		// Idle release reads the same rule ChatPanel passes.
		let released = false;
		act(() => {
			released = t.result.current.lazy.release({
				keepSessionId: decideKeepSessionId({
					hasMessages: false,
					holdsKeptId: t.result.current.lazy.continuesExistingSession(),
				}),
			});
		});
		expect(released).toBe(true);
		expect(t.result.current.lazy.keptSessionId).toBeNull();

		// Reconnect, then a failing reload.
		act(() => {
			t.result.current.lazy.onSendClick("");
		});
		await act(settle);
		expect(t.result.current.lazy.sessionId).toBe("fresh-2");
		t.agent.reachable = false;
		await act(async () => {
			await t.result.current.actions.handleReload(false);
		});
		expect(t.result.current.lazy.keptSessionId).toBeNull();
		expect(t.loadExistingSession).not.toHaveBeenCalled();
	});

	it("a lossy reload forgets the old id; a later failed reload keeps the new one", async () => {
		const t = setup({ reloadFailure: "throws", restoredSessionId: "launch-check" });
		act(() => {
			t.result.current.lazy.onSendClick("");
		});
		await act(settle);
		expect(t.result.current.lazy.sessionId).toBe("launch-check");

		// A reload that resumes nothing and starts fresh.
		t.reloadSession.mockImplementationOnce(async () => {
			t.calls.push("reload");
			return { resumed: false as const, reason: "resume-failed" as const, sessionId: "fresh-9" };
		});
		await act(async () => {
			await t.result.current.actions.handleReload(false);
		});
		expect(t.result.current.lazy.sessionId).toBe("fresh-9");
		expect(t.result.current.lazy.keptSessionId).toBeNull();
		expect(t.fallbacks).toEqual([["unavailable", "fresh-9"]]);

		t.agent.reachable = false;
		await act(async () => {
			await t.result.current.actions.handleReload(false);
		});
		expect(t.result.current.lazy.keptSessionId).toBe("fresh-9");

		t.agent.reachable = true;
		t.calls.length = 0;
		act(() => {
			t.result.current.queue.dispatch({
				type: "sendWhilePreReady",
				message: { content: "after" },
			});
		});
		await act(settle);
		expect(t.calls).toEqual(["initialize", "load:fresh-9"]);
		expect(t.fallbacks).toEqual([["unavailable", "fresh-9"]]);
		expect(t.delivered).toEqual(["after"]);
	});

	it("a resumed reload keeps the id the agent returned; a later failed reload loads that id", async () => {
		const t = setup({ reloadFailure: "throws" });
		act(() => {
			t.result.current.lazy.onSendClick("");
		});
		await act(settle);
		expect(t.result.current.lazy.sessionId).toBe("fresh-1");

		t.reloadSession.mockImplementationOnce(async () => {
			t.calls.push("reload");
			return { resumed: true as const, sessionId: "fresh-1b" };
		});
		await act(async () => {
			await t.result.current.actions.handleReload(false);
		});
		expect(t.result.current.lazy.sessionId).toBe("fresh-1b");
		expect(t.result.current.lazy.keptSessionId).toBe("fresh-1b");

		t.agent.reachable = false;
		await act(async () => {
			await t.result.current.actions.handleReload(false);
		});
		expect(t.result.current.lazy.keptSessionId).toBe("fresh-1b");

		t.agent.reachable = true;
		t.calls.length = 0;
		act(() => {
			t.result.current.lazy.onSendClick("");
		});
		await act(settle);
		expect(t.calls).toEqual(["initialize", "load:fresh-1b"]);
		expect(t.fallbacks).toEqual([]);
	});
});
