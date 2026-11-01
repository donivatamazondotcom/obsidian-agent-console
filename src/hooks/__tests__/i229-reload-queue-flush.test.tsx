/**
 * I229 — reproduce-first: a message sent during a soft reload must be
 * delivered once the reloaded session is ready.
 *
 * Observed on Kiro V2 (2026-10-27): send 1.5 s after `reload-session`; the
 * banner went "Queued – sends when ready" → "Queued – sends when Kiro CLI is
 * done" and the message never went out (140+ s), though a new session was live
 * from +8 s. With a 15 s wait before sending, the message went out normally.
 *
 * Seam (R2): the real hooks ChatPanel composes for this path —
 * `useAgentSession` (real `reloadSession` → `reloadSessionFlow`),
 * `useLazySession` and `useQueueOrchestration` — glued by the SAME production
 * resolvers ChatPanel calls (`deriveSendAffordance`,
 * `decideComposerEnterAction`, `decideQueuedSendKind`, `decideConnectFlush`).
 * The reload runs the way `useChatActions.handleReload` runs it: through
 * `lazy.reloadNow(() => agent.reloadSession())`. Only the ACP client port is
 * faked (R4). The glue mirrors ChatPanel's inputs
 * one-for-one: the composer reads `agent.isReady` (agent session state) as
 * `isSessionReady`, while queue routing and the connect-flush read
 * `lazySession.state`. `flushDispatch` records what the raw send would deliver
 * and on which session (R3). Expected values are literals (R5).
 *
 * Spec: [[I229 Send queued during soft reload never flushes]].
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useCallback, useEffect, useRef } from "react";
import { useAgentSession } from "../useAgentSession";
import { useLazySession } from "../useLazySession";
import { useQueueOrchestration } from "../useQueueOrchestration";
import { reloadResultToAcquisition } from "../reloadSessionFlow";
import { deriveSendAffordance } from "../../resolvers/send-affordance";
import {
	decideComposerEnterAction,
	decideConnectFlush,
	decideQueuedSendKind,
} from "../../services/message-queue-logic";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";
import type { QueuedMessage } from "../../types/chat";

afterEach(cleanup);

const AGENT = "test-agent";

type LoadBehavior = "resumes" | "always-fails";

/**
 * Fake ACP client. `disconnect()` arms a teardown the TEST releases by hand,
 * so the send can be placed inside the reload window deterministically.
 */
function makeClient(load: LoadBehavior) {
	let sessionCounter = 0;
	let releaseTeardown: (() => void) | null = null;
	let pendingTeardown: Promise<void> = Promise.resolve();

	const agentClient = {
		isInitialized: () => true,
		getCurrentAgentId: () => AGENT,
		initialize: vi.fn(async () => ({})),
		newSession: vi.fn(async () => {
			sessionCounter += 1;
			return {
				sessionId: `s${sessionCounter}`,
				modes: undefined,
				models: undefined,
				configOptions: undefined,
			};
		}),
		loadSession: vi.fn(async (sid: string) => {
			if (load === "always-fails") {
				throw new Error("Session is active in another process");
			}
			return {
				sessionId: sid,
				modes: undefined,
				models: undefined,
				configOptions: undefined,
			};
		}),
		disconnect: vi.fn(async () => {
			pendingTeardown = new Promise<void>((resolve) => {
				releaseTeardown = resolve;
			});
		}),
		whenTornDown: vi.fn(() => pendingTeardown),
		getInitializeResult: () => ({
			capabilities: { restoresViaLoad: true, restoresViaResume: false },
		}),
		setSessionConfigOption: vi.fn(async () => []),
		setSessionModel: vi.fn(async () => {}),
		setSessionMode: vi.fn(async () => {}),
	} as unknown as AcpClient;

	return {
		agentClient,
		releaseTeardown: () => releaseTeardown?.(),
	};
}

function makeSettingsAccess(): ISettingsAccess {
	const settings: Record<string, unknown> = {
		defaultAgentId: AGENT,
		claude: { id: "claude", displayName: "Claude" },
		codex: { id: "codex", displayName: "Codex" },
		gemini: { id: "gemini", displayName: "Gemini" },
		kiro: { id: "kiro", displayName: "Kiro" },
		opencode: { id: "opencode-acp", displayName: "OpenCode" },
		customAgents: [
			{
				id: AGENT,
				displayName: "Test Agent",
				command: "kiro-cli",
				args: ["acp"],
				env: [],
			},
		],
		lastUsedModels: {},
		lastUsedModes: {},
		lastUsedThoughtLevels: {},
	};
	return {
		getSnapshot: () => settings,
		updateSettings: vi.fn(async () => {}),
	} as unknown as ISettingsAccess;
}

/**
 * ChatPanel's composition for one tab, with the raw send replaced by a
 * recorder. Every decision is the production resolver ChatPanel uses.
 */
function useTabHarness(agentClient: AcpClient, settings: ISettingsAccess) {
	const agent = useAgentSession(agentClient, settings, "/cwd", () => {}, AGENT);
	const agentRef = useRef(agent);
	agentRef.current = agent;

	const delivered = useRef<Array<{ content: string; sessionId: string | null }>>(
		[],
	);
	const effects = useRef({
		acquire: () => {},
		flushDispatch: (_m: QueuedMessage) => {},
	});
	const queue = useQueueOrchestration({
		acquire: () => effects.current.acquire(),
		flushDispatch: (m) => effects.current.flushDispatch(m),
		clearComposer: () => {},
		cancelTurn: () => {},
	});

	const lazy = useLazySession({
		restoredSessionId: null,
		eagerAcquire: true,
		acquireNewSession: useCallback(async () => {
			const sid = await agentRef.current.createSession();
			return sid
				? { ok: true as const, sessionId: sid }
				: { ok: false as const, error: new Error("no session") };
		}, []),
		loadExistingSession: useCallback(
			async () => ({ ok: false as const, error: new Error("unused") }),
			[],
		),
		sendPrompt: useCallback(async () => {}, []),
	});

	effects.current = {
		acquire: () => lazy.onSendClick(""),
		// handleSendMessage reads agent.session.sessionId at send time.
		flushDispatch: (m) =>
			delivered.current.push({
				content: m.content,
				sessionId: agentRef.current.session.sessionId,
			}),
	};

	// ChatPanel connect-flush effect, verbatim inputs.
	const prevLazyStateRef = useRef<string>(lazy.state);
	const awaitingSessionIdRef = useRef(false);
	useEffect(() => {
		const decision = decideConnectFlush({
			prevState: prevLazyStateRef.current,
			state: lazy.state,
			hasSessionId: !!agent.session.sessionId,
			awaitingSessionId: awaitingSessionIdRef.current,
		});
		prevLazyStateRef.current = lazy.state;
		awaitingSessionIdRef.current = decision.awaitingSessionId;
		if (decision.dispatchAcquisitionComplete) {
			queue.dispatch({ type: "acquisitionComplete", hasSessionId: true });
		}
		if (decision.dispatchAcquisitionFailed) {
			queue.dispatch({ type: "acquisitionFailed" });
		}
	}, [lazy.state, agent.session.sessionId, queue.dispatch]);

	/** The user presses Enter with `content` in the composer (InputArea path). */
	const pressEnter = (content: string) => {
		const isSending = false; // no prompt is in flight during a reload
		const { buttonDisabled } = deriveSendAffordance({
			lazyState: lazy.state,
			isSending,
			isQueued: queue.isQueued,
			hasContent: true,
			isRestoringSession: false,
		});
		const action = decideComposerEnterAction({
			isStreaming: isSending,
			isSessionReady: agent.isReady,
			isButtonDisabled: buttonDisabled,
			isQueued: queue.isQueued,
			hasContent: true,
		});
		if (action === "send") {
			// handleSendWithLazyAcquisition: ready + sessionId → raw send.
			if (lazy.state === "ready" && agent.session.sessionId) {
				effects.current.flushDispatch({ content });
			} else {
				queue.dispatch({ type: "sendWhilePreReady", message: { content } });
			}
		} else if (action === "queue") {
			// handleQueueMessage.
			queue.dispatch({
				type: decideQueuedSendKind(lazy.state),
				message: { content },
			});
		}
		return action;
	};

	/** handleReload's soft branch: reload through the single lazy owner. */
	const softReload = () =>
		lazy.reloadNow(async () =>
			reloadResultToAcquisition(await agentRef.current.reloadSession()),
		);

	/** Hold a message behind a running turn (handleQueueMessage while busy). */
	const holdBehindTurn = (content: string) =>
		queue.dispatch({ type: "sendWhileStreaming", message: { content } });

	return {
		agent,
		lazy,
		queue,
		delivered,
		pressEnter,
		softReload,
		holdBehindTurn,
	};
}

const settle = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

async function mountReadyTab(load: LoadBehavior) {
	const client = makeClient(load);
	const hook = renderHook(() =>
		useTabHarness(client.agentClient, makeSettingsAccess()),
	);
	// Eager acquisition → s1, lazy state ready (a tab with a finished turn
	// sits in the same `ready` state).
	await act(settle);
	expect(hook.result.current.lazy.state).toBe("ready");
	expect(hook.result.current.agent.session.sessionId).toBe("s1");
	return { client, hook };
}

describe("I229: a send queued during a soft reload is delivered once the session is ready", () => {
	it("resume path: delivered once, on the resumed session", async () => {
		const { client, hook } = await mountReadyTab("resumes");

		let reload: Promise<unknown> = Promise.resolve();
		act(() => {
			reload = hook.result.current.softReload();
		});
		await act(settle);
		// Inside the reload window: the old tree hasn't exited yet.
		expect(hook.result.current.agent.isReady).toBe(false);
		// One owner of "connecting": the lazy machine left `ready`, so a send
		// now is a pre-ready hold that the connect-flush delivers.
		expect(hook.result.current.lazy.state).toBe("connecting");
		expect(decideQueuedSendKind(hook.result.current.lazy.state)).toBe(
			"sendWhilePreReady",
		);

		act(() => {
			hook.result.current.pressEnter("hello after reload");
		});
		expect(hook.result.current.queue.isQueued).toBe(true);

		await act(async () => {
			client.releaseTeardown();
			await reload;
			await settle();
		});

		expect(hook.result.current.agent.isReady).toBe(true);
		expect(hook.result.current.lazy.state).toBe("ready");
		expect(hook.result.current.delivered.current).toEqual([
			{ content: "hello after reload", sessionId: "s1" },
		]);
		expect(hook.result.current.queue.isQueued).toBe(false);
	});

	it("resume-fails fallback: delivered once, on the replacement session", async () => {
		const { client, hook } = await mountReadyTab("always-fails");

		let reload: Promise<unknown> = Promise.resolve();
		act(() => {
			reload = hook.result.current.softReload();
		});
		await act(settle);
		expect(hook.result.current.agent.isReady).toBe(false);

		act(() => {
			hook.result.current.pressEnter("hello after reload");
		});
		expect(hook.result.current.queue.isQueued).toBe(true);

		await act(async () => {
			client.releaseTeardown();
			await reload;
			await settle();
		});

		expect(hook.result.current.agent.session.sessionId).toBe("s2");
		expect(hook.result.current.delivered.current).toEqual([
			{ content: "hello after reload", sessionId: "s2" },
		]);
		expect(hook.result.current.queue.isQueued).toBe(false);
	});

	it("control (15 s wait): a send after the reload completes goes out directly", async () => {
		const { client, hook } = await mountReadyTab("resumes");

		await act(async () => {
			const reload = hook.result.current.softReload();
			await settle();
			client.releaseTeardown();
			await reload;
			await settle();
		});

		let action: string | undefined;
		act(() => {
			action = hook.result.current.pressEnter("hello later");
		});
		expect(action).toBe("send");
		expect(hook.result.current.delivered.current).toEqual([
			{ content: "hello later", sessionId: "s1" },
		]);
	});

	it("a second Enter during the reload doesn't send twice (one message at a time)", async () => {
		const { client, hook } = await mountReadyTab("resumes");

		let reload: Promise<unknown> = Promise.resolve();
		act(() => {
			reload = hook.result.current.softReload();
		});
		await act(settle);
		act(() => {
			hook.result.current.pressEnter("first");
		});
		act(() => {
			hook.result.current.pressEnter("second");
		});

		await act(async () => {
			client.releaseTeardown();
			await reload;
			await settle();
		});

		expect(hook.result.current.delivered.current).toEqual([
			{ content: "first", sessionId: "s1" },
		]);
	});

	it("a message held behind a running turn is not flushed by the reload's ready edge (I110)", async () => {
		const { client, hook } = await mountReadyTab("resumes");
		act(() => {
			hook.result.current.holdBehindTurn("after the turn");
		});

		await act(async () => {
			const reload = hook.result.current.softReload();
			await settle();
			client.releaseTeardown();
			await reload;
			await settle();
		});

		expect(hook.result.current.lazy.state).toBe("ready");
		expect(hook.result.current.delivered.current).toEqual([]);
		expect(hook.result.current.queue.isQueued).toBe(true);
	});
});
