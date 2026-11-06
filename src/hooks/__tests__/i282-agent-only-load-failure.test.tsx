/**
 * I282: opening an Agent-view row that has no local record, when the agent
 * can't load it, says "This session is no longer on {agent}" with Close.
 * It doesn't fall back to a new session and doesn't claim a transcript.
 *
 * Before the fix the restored path fell back on any failed load, set
 * `isFallbackRecovery`, and the notice said "I'm working from a transcript of
 * your previous conversation" with no transcript anywhere. A Kiro V3 load of
 * an id it never had (I264) succeeded empty and bound silently.
 *
 * Seams (R2): the public `useLazySession` hook wired to the real
 * `reconnectExistingSession`, exactly as ChatPanel wires them; the rendered
 * MessageList; the queued-banner text builder. Only the ACP client port is
 * faked (R4); it answers like Kiro V2 (`-32603`), Claude Code (`-32002`) or
 * Kiro V3 (empty success). Literals only (R5).
 *
 * Spec: [[I282 Opening an agent-only row that fails to load claims a transcript it doesn't have]].
 */
import { describe, expect, it, vi } from "vitest";
import { act, render, renderHook, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { RequestError } from "@agentclientprotocol/sdk";

import { useLazySession } from "../useLazySession";
import {
	reconnectExistingSession,
	type ReconnectClientPort,
} from "../loadExistingSessionFlow";
import { MessageList } from "../../ui/MessageList";
import { buildQueuedBanner } from "../../services/message-queue-logic";
import { shouldShowRecoverableHistory } from "../../resolvers/conversation-empty-state";
import type { IChatViewHost } from "../../ui/view-host";
import type AgentClientPlugin from "../../plugin";
import { NO_AGENT_CAPABILITIES, type SessionResult } from "../../types/session";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
	setTooltip: vi.fn(),
	MarkdownRenderer: { render: vi.fn() },
	Component: class {},
	Platform: { isMobile: false },
}));

vi.mock("../../ui/MessageBubble", () => ({
	MessageBubble: () => <div data-testid="bubble" />,
}));

type LoadAnswer =
	| "v2-not-found"
	| "claude-not-found"
	| "v3-empty"
	| "connection-closed"
	| "known";

function fakeClient(answer: LoadAnswer, opts: { initFails?: boolean } = {}) {
	let initialized = false;
	let answerNow = answer;
	const client: ReconnectClientPort = {
		isInitialized: () => initialized,
		getInitializeResult: () =>
			initialized
				? {
						capabilities: { ...NO_AGENT_CAPABILITIES, restoresViaLoad: true },
						kiroEngine: "v3",
					}
				: null,
		loadSession: vi.fn(async (sid: string): Promise<SessionResult> => {
			switch (answerNow) {
				case "known":
					return { sessionId: sid, replayedConversationUpdates: 2 };
				case "v3-empty":
					return { sessionId: sid, replayedConversationUpdates: 0 };
				case "v2-not-found":
					throw new RequestError(-32603, "Internal error: Session not found");
				case "claude-not-found":
					throw new RequestError(-32002, "Resource not found");
				case "connection-closed":
					throw new Error("ACP connection closed");
			}
		}),
		resumeSession: vi.fn(async (sid: string) => ({ sessionId: sid })),
	};
	const initialize = vi.fn(async () => {
		if (opts.initFails) throw new Error("spawn kiro-cli ENOENT");
		initialized = true;
	});
	return {
		client,
		initialize,
		answerWith: (a: LoadAnswer) => {
			answerNow = a;
		},
	};
}

/**
 * A restored tab as ChatPanel wires it. `hasLocalRecord` is the I269 record
 * binding; an Agent-view row with no local record has none.
 */
function mountRow(opts: {
	answer: LoadAnswer;
	hasLocalRecord: boolean;
	transcriptOnScreen?: number;
	initFails?: boolean;
	holdLoad?: boolean;
}) {
	const acp = fakeClient(opts.answer, { initFails: opts.initFails });
	const acquireNewSession = vi.fn(async () => ({
		ok: true as const,
		sessionId: "new-1",
	}));
	const onSessionFallback = vi.fn();
	let releaseLoad: () => void = () => {};
	let loadGate = new Promise<void>((r) => {
		releaseLoad = r;
	});
	let hold = opts.holdLoad ?? false;
	const holdNextLoad = () => {
		hold = true;
		loadGate = new Promise<void>((r) => {
			releaseLoad = r;
		});
	};
	const onScreen = opts.transcriptOnScreen ?? 0;
	const hook = renderHook(() =>
		useLazySession({
			restoredSessionId: "agent-row-1",
			acquireNewSession,
			loadExistingSession: async (id) => {
				if (hold) await loadGate;
				return reconnectExistingSession({
					sessionId: id,
					cwd: "/vault",
					client: acp.client,
					initialize: acp.initialize,
					haveLocalHistory: () => onScreen > 0,
					hasLocalRecord: () => opts.hasLocalRecord,
					onLoaded: () => {},
					setIgnoreUpdates: () => {},
				});
			},
			hasLocalRecord: () => opts.hasLocalRecord,
			haveLocalHistory: () => onScreen > 0,
			onSessionFallback,
			sendPrompt: vi.fn(),
			debounceMs: 0,
		}),
	);
	async function send() {
		await act(async () => {
			hook.result.current.onSendClick("What did we decide?");
		});
	}
	return {
		hook,
		acp,
		acquireNewSession,
		onSessionFallback,
		send,
		releaseLoad: () => releaseLoad(),
		holdNextLoad,
	};
}

function renderEmpty(lazy: {
	state: string;
	sessionGone: boolean;
	isFallbackRecovery: boolean;
}, onClose = vi.fn()) {
	const view = render(
		<MessageList
			messages={[]}
			isSending={false}
			lazyState={lazy.state as "error"}
			isRestoringSession={false}
			agentLabel="Claude Code"
			plugin={{} as AgentClientPlugin}
			view={{ registerDomEvent: vi.fn() } as unknown as IChatViewHost}
			hasActivePermission={false}
			isFallbackRecovery={lazy.isFallbackRecovery}
			sessionGone={lazy.sessionGone}
			onCloseSessionGone={onClose}
		/>,
	);
	return { ...view, onClose };
}

describe("I282 agent-only row: the agent can't load it", () => {
	it.each(["v2-not-found", "claude-not-found"] as const)(
		"%s: no fallback, no transcript claim; the tab says the session is gone",
		async (answer) => {
			const row = mountRow({ answer, hasLocalRecord: false });
			await row.send();
			await waitFor(() => expect(row.hook.result.current.state).toBe("error"));

			const lazy = row.hook.result.current;
			expect(row.acquireNewSession).not.toHaveBeenCalled();
			expect(row.onSessionFallback).not.toHaveBeenCalled();
			expect(lazy.isFallbackRecovery).toBe(false);
			expect(lazy.sessionGone).toBe(true);

			const { container, onClose, unmount } = renderEmpty(lazy);
			expect(container.textContent).toContain(
				"This session is no longer on Claude Code.",
			);
			expect(container.textContent).not.toContain("transcript");
			expect(container.textContent).not.toContain("Couldn't connect");
			within(container).getByRole("button", { name: "Close" }).click();
			expect(onClose).toHaveBeenCalledTimes(1);
			unmount();
		},
	);

	it("Kiro V3 empty load of a row with no record is gone too (I264)", async () => {
		const row = mountRow({ answer: "v3-empty", hasLocalRecord: false });
		await row.send();
		await waitFor(() => expect(row.hook.result.current.state).toBe("error"));
		expect(row.acquireNewSession).not.toHaveBeenCalled();
		expect(row.hook.result.current.sessionGone).toBe(true);
		expect(row.hook.result.current.sessionId).toBeNull();
	});

	it("the agent never started: says it couldn't connect, not gone", async () => {
		const row = mountRow({
			answer: "v2-not-found",
			hasLocalRecord: false,
			initFails: true,
		});
		await row.send();
		await waitFor(() => expect(row.hook.result.current.state).toBe("error"));
		expect(row.acquireNewSession).not.toHaveBeenCalled();
		expect(row.hook.result.current.sessionGone).toBe(false);
		expect(row.hook.result.current.isFallbackRecovery).toBe(false);
		const { container } = renderEmpty(row.hook.result.current);
		expect(container.textContent).toContain("Couldn't connect to Claude Code");
	});

	it("a closed connection is a connect failure, not gone", async () => {
		const row = mountRow({ answer: "connection-closed", hasLocalRecord: false });
		await row.send();
		await waitFor(() => expect(row.hook.result.current.state).toBe("error"));
		expect(row.hook.result.current.sessionGone).toBe(false);
		expect(row.acquireNewSession).not.toHaveBeenCalled();
	});

	it("a send retries the load; a later success clears gone and binds the row", async () => {
		const row = mountRow({ answer: "v2-not-found", hasLocalRecord: false });
		await row.send();
		await waitFor(() => expect(row.hook.result.current.sessionGone).toBe(true));
		row.acp.answerWith("known");
		await row.send();
		await waitFor(() => expect(row.hook.result.current.state).toBe("ready"));
		expect(row.hook.result.current.sessionGone).toBe(false);
		expect(row.hook.result.current.sessionId).toBe("agent-row-1");
		expect(row.acp.client.loadSession).toHaveBeenCalledTimes(2);
	});

	it("while a retry is loading, the tab reads as connecting, not gone", async () => {
		const row = mountRow({ answer: "v2-not-found", hasLocalRecord: false });
		await row.send();
		await waitFor(() => expect(row.hook.result.current.sessionGone).toBe(true));
		row.acp.answerWith("known");
		row.holdNextLoad();
		await row.send();
		await waitFor(() => expect(row.hook.result.current.state).toBe("connecting"));
		expect(row.hook.result.current.sessionGone).toBe(false);
		const { container, unmount } = renderEmpty(row.hook.result.current);
		expect(container.textContent).not.toContain("no longer on");
		expect(container.querySelector("button")).toBeNull();
		unmount();
		expect(
			buildQueuedBanner({
				agentLabel: "Claude Code",
				isSessionReady: false,
				connectFailed: false,
				sessionGone: row.hook.result.current.sessionGone,
			}),
		).toBe("Queued — sends when ready");
		await act(async () => {
			row.releaseLoad();
		});
		await waitFor(() => expect(row.hook.result.current.state).toBe("ready"));
		// It bound the original session; nothing fell back.
		expect(row.hook.result.current.sessionGone).toBe(false);
		expect(row.hook.result.current.sessionId).toBe("agent-row-1");
		expect(row.acquireNewSession).not.toHaveBeenCalled();
		expect(row.acp.client.loadSession).toHaveBeenCalledTimes(2);
	});

	it("New chat clears gone", async () => {
		const row = mountRow({ answer: "v2-not-found", hasLocalRecord: false });
		await row.send();
		await waitFor(() => expect(row.hook.result.current.sessionGone).toBe(true));
		act(() => row.hook.result.current.reset());
		expect(row.hook.result.current.sessionGone).toBe(false);
	});

	it("a reset while the load is in flight leaves no stale flag", async () => {
		for (const hasLocalRecord of [false, true]) {
			const row = mountRow({
				answer: "v2-not-found",
				hasLocalRecord,
				transcriptOnScreen: hasLocalRecord ? 2 : 0,
				holdLoad: true,
			});
			await row.send();
			act(() => row.hook.result.current.reset());
			await act(async () => {
				row.releaseLoad();
			});
			await new Promise((r) => setTimeout(r, 0));
			expect(row.hook.result.current.sessionGone).toBe(false);
			expect(row.hook.result.current.isFallbackRecovery).toBe(false);
			expect(row.acquireNewSession).not.toHaveBeenCalled();
		}
	});
});

describe("I282 a row with a local record keeps the I246 fallback", () => {
	it("failed load: falls back to a new session and reports it", async () => {
		const row = mountRow({
			answer: "v2-not-found",
			hasLocalRecord: true,
			transcriptOnScreen: 2,
		});
		await row.send();
		await waitFor(() => expect(row.hook.result.current.state).toBe("ready"));
		expect(row.acquireNewSession).toHaveBeenCalledTimes(1);
		expect(row.onSessionFallback).toHaveBeenCalledWith("unavailable", "new-1");
		expect(row.hook.result.current.isFallbackRecovery).toBe(true);
		expect(row.hook.result.current.sessionGone).toBe(false);
	});

	it("a record with a transcript on screen and a V3 empty load falls back (I264 unchanged)", async () => {
		const row = mountRow({
			answer: "v3-empty",
			hasLocalRecord: true,
			transcriptOnScreen: 2,
		});
		await row.send();
		await waitFor(() => expect(row.hook.result.current.state).toBe("ready"));
		expect(row.acquireNewSession).toHaveBeenCalledTimes(1);
		expect(row.onSessionFallback).toHaveBeenCalledWith("unavailable", "new-1");
		expect(row.hook.result.current.sessionGone).toBe(false);
	});

	it("a record with nothing on screen and an empty load still loads as an empty chat", async () => {
		const row = mountRow({ answer: "v3-empty", hasLocalRecord: true });
		await row.send();
		await waitFor(() => expect(row.hook.result.current.state).toBe("ready"));
		expect(row.hook.result.current.sessionId).toBe("agent-row-1");
		expect(row.acquireNewSession).not.toHaveBeenCalled();
	});
});

describe("I282 other surfaces agree with the gone notice", () => {
	it("the held-message banner doesn't promise a retry", () => {
		expect(
			buildQueuedBanner({
				agentLabel: "Claude Code",
				isSessionReady: false,
				connectFailed: true,
				sessionGone: true,
			}),
		).toBe("Not sent. This session is no longer on Claude Code.");
	});

	it("the 'Reload from agent' banner is hidden once the session is gone", () => {
		const base = { historyRecoverable: true, messageCount: 0, sessionId: null };
		expect(shouldShowRecoverableHistory({ ...base, sessionGone: false })).toBe(true);
		expect(shouldShowRecoverableHistory({ ...base, sessionGone: true })).toBe(false);
	});
});
