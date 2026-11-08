/**
 * I259: retiring a tab deletes its agent session when this process created
 * it and nothing was ever sent to it, so empty Kiro V3 chats stop piling up
 * in the Agent view.
 *
 * Seams (R2): the public `useSessionRetirement` hook, `decideSessionIntent`,
 * `retireLiveSession`, `retireClosedTabClient` (tab close) and
 * `runIdleRelease`, all driving a REAL AcpClient. Only the ACP connection is
 * faked (R4): it records the ordered method log and answers like the
 * 2026-11-07 probes (Kiro V3 and Claude Code advertise delete; Kiro V2 has
 * no session capabilities). The outcome asserted (R3) is the method log the
 * agent receives: `session/delete` before close / disconnect, or none.
 *
 * Spec: [[I259 Empty Kiro chats pile up in the Agent view]] § Spec.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import * as acp from "@agentclientprotocol/sdk";

import { AcpClient } from "../../acp/acp-client";
import { AcpTypeConverter } from "../../acp/type-converter";
import type AgentClientPlugin from "../../plugin";
import type { RawAgentCapabilities } from "../../types/session";
import { useSessionRetirement } from "../useSessionRetirement";
import { decideSessionIntent } from "../../resolvers/agent-switch";
import { retireClosedTabClient } from "../../services/retire-live-session";
import { createReleaseGate, runIdleRelease } from "../useIdleRelease";
import { idleReleaseDiscardSteps } from "../useSessionRetirement";
import { closedTabSessionId } from "../../services/recently-closed-stack";

const RAW: Record<"v3" | "v2" | "claude", RawAgentCapabilities> = {
	v3: { loadSession: true, sessionCapabilities: { list: {}, close: {}, delete: {}, fork: {} } },
	v2: { loadSession: true, sessionCapabilities: {} },
	claude: {
		loadSession: true,
		sessionCapabilities: { list: {}, close: {}, delete: {}, fork: {}, resume: {} },
	},
};

type Seams = {
	connection: unknown;
	cachedInitResult: unknown;
	isInitializedFlag: boolean;
	agentProcess: unknown;
};

type DeleteMode = "ok" | "reject" | "hang";

function makeAgent(engine: keyof typeof RAW, del: DeleteMode = "ok") {
	const plugin = {
		settings: { autoAllowPermissions: false, windowsWslMode: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	const client = new AcpClient(plugin);
	const seams = client as unknown as Seams;
	const log: string[] = [];
	let counter = 0;
	const request = vi.fn(async (method: string, params: { sessionId?: string }) => {
		log.push(params?.sessionId ? `${method} ${params.sessionId}` : method);
		switch (method) {
			case acp.methods.agent.session.new:
				counter += 1;
				return { sessionId: `sess_${counter}` };
			case acp.methods.agent.session.prompt:
				return { stopReason: "end_turn" };
			case acp.methods.agent.session.delete:
				if (del === "reject") throw new Error("Session not found");
				if (del === "hang") return new Promise(() => {});
				return {};
			default:
				return {};
		}
	});
	seams.connection = {
		agent: { request, notify: vi.fn(async () => undefined) },
	};
	seams.isInitializedFlag = true;
	seams.agentProcess = { pid: undefined, stdin: null, exitCode: null, killed: false, once: () => undefined };
	seams.cachedInitResult = {
		capabilities: AcpTypeConverter.toAgentCapabilities(RAW[engine]),
	};
	const origDisconnect = client.disconnect.bind(client);
	vi.spyOn(client, "disconnect").mockImplementation(() => {
		log.push("disconnect");
		seams.connection = null;
		seams.agentProcess = null;
		return origDisconnect();
	});
	return { client, log };
}

interface TabState {
	sessionId: string | null;
	messageCount: number;
	isQueued: boolean;
	sendAttempted: boolean;
	recordId: string | null;
}

function mountTab(client: AcpClient, initial: Partial<TabState> = {}) {
	const state: TabState = {
		sessionId: null,
		messageCount: 0,
		isQueued: false,
		sendAttempted: false,
		recordId: null,
		...initial,
	};
	const warn = vi.fn();
	const hook = renderHook(() =>
		useSessionRetirement({
			client,
			getSessionId: () => state.sessionId,
			getMessageCount: () => state.messageCount,
			isQueued: () => state.isQueued,
			hasAttemptedSend: () => state.sendAttempted,
			getRecordId: () => state.recordId,
			warn,
		}),
	);
	const update = (patch: Partial<TabState>) => {
		Object.assign(state, patch);
		hook.rerender();
	};
	return { hook, state, update, warn };
}

/** ChatPanel.handleNewChatWithPersist's retirement step for a New chat. */
async function newChat(
	tab: ReturnType<typeof mountTab>,
	client: AcpClient,
	requestedAgentId?: string,
) {
	const snap = tab.hook.result.current.snapshot();
	const decision = decideSessionIntent({
		intent: requestedAgentId ? "switch-agent" : "new-chat",
		currentAgentId: "kiro-cli",
		requestedAgentId,
		hasSession: tab.state.sessionId !== null,
		messageCount: tab.state.messageCount,
		closesSessions:
			client.getInitializeResult()?.capabilities.closesSessions ?? false,
	});
	if (decision.kind !== "recreate-eager" && decision.kind !== "recreate-lazy") {
		throw new Error(`unexpected ${decision.kind}`);
	}
	await tab.hook.result.current.retire(
		decision.retire,
		{
			closeLiveSession: async () => {
				if (tab.state.sessionId) await client.closeSession(tab.state.sessionId);
			},
			respawn: () => client.disconnect(),
			warn: () => undefined,
		},
		snap,
	);
}

afterEach(() => {
	vi.useRealTimers();
});

describe("I259 — New chat and agent switch on an empty tab", () => {
	it("Kiro V3: New chat deletes the never-sent session, then closes it", async () => {
		const { client, log } = makeAgent("v3");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId });
		await act(() => newChat(tab, client));
		expect(log).toEqual([
			"session/new",
			"session/delete sess_1",
			"session/close sess_1",
		]);
	});

	it("Claude Code: the same delete then close", async () => {
		const { client, log } = makeAgent("claude");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId });
		await act(() => newChat(tab, client));
		expect(log).toContain("session/delete sess_1");
	});

	it("agent switch (retire none) deletes on the old process before the switch", async () => {
		const { client, log } = makeAgent("v3");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId });
		await act(() => newChat(tab, client, "claude-code-acp"));
		expect(log).toEqual(["session/new", "session/delete sess_1"]);
	});

	it("Kiro V2 (no delete): New chat never sends session/delete", async () => {
		const { client, log } = makeAgent("v2");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId });
		await act(() => newChat(tab, client));
		expect(log.some((l) => l.startsWith("session/delete"))).toBe(false);
	});
});

describe("I259 — sessions that must never be deleted", () => {
	it("a session that got a send", async () => {
		const { client, log } = makeAgent("v3");
		const { sessionId } = await client.newSession("/tmp");
		await client.sendPrompt(sessionId, [{ type: "text", text: "hi" }]);
		const tab = mountTab(client, { sessionId, messageCount: 0 });
		await act(() => newChat(tab, client));
		expect(log.some((l) => l.startsWith("session/delete"))).toBe(false);
	});

	it("a send still being prepared (no message on screen yet)", async () => {
		const { client, log } = makeAgent("v3");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId, sendAttempted: true });
		await act(() => newChat(tab, client));
		expect(log.some((l) => l.startsWith("session/delete"))).toBe(false);
	});

	it("a queued send", async () => {
		const { client, log } = makeAgent("v3");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId, isQueued: true });
		await act(() => newChat(tab, client));
		expect(log.some((l) => l.startsWith("session/delete"))).toBe(false);
	});

	it("a session with a local record (a fallback session)", async () => {
		const { client, log } = makeAgent("v3");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId, recordId: "rec_1" });
		await act(() => newChat(tab, client));
		expect(log.some((l) => l.startsWith("session/delete"))).toBe(false);
	});

	it("a session with messages on screen (a local fork branch)", async () => {
		const { client, log } = makeAgent("v3");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId, messageCount: 4 });
		await act(() => newChat(tab, client));
		expect(log.some((l) => l.startsWith("session/delete"))).toBe(false);
	});

	it("a loaded session", async () => {
		const { client, log } = makeAgent("v3");
		await client.loadSession("sess_restored", "/tmp");
		const tab = mountTab(client, { sessionId: "sess_restored" });
		await act(() => newChat(tab, client));
		expect(log.some((l) => l.startsWith("session/delete"))).toBe(false);
	});

	it("reads the live inputs at call time, without a re-render", async () => {
		const { client, log } = makeAgent("v3");
		const tab = mountTab(client, { sessionId: null });
		const { sessionId } = await client.newSession("/tmp");
		// The session and its send land after the last render: snapshot must
		// still see both (the tab-close path reaches it through a handle).
		tab.state.sessionId = sessionId;
		await client.sendPrompt(sessionId, [{ type: "text", text: "hi" }]);
		expect(tab.hook.result.current.snapshot()).toEqual({
			kind: "keep",
			reason: "sent-or-not-ours",
		});
		expect(log.some((l) => l.startsWith("session/delete"))).toBe(false);
	});
});

describe("I259 — tab close", () => {
	it("deletes before the process is killed", async () => {
		const { client, log } = makeAgent("v3");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId });
		const snap = tab.hook.result.current.snapshot();
		await retireClosedTabClient(client, snap, vi.fn());
		expect(log).toEqual(["session/new", "session/delete sess_1", "disconnect"]);
	});

	it("a keep decision (view close, no handle, real chat) only disconnects", async () => {
		const { client, log } = makeAgent("v3");
		await client.newSession("/tmp");
		await retireClosedTabClient(
			client,
			{ kind: "keep", reason: "no-session" },
			vi.fn(),
		);
		expect(log).toEqual(["session/new", "disconnect"]);
	});

	it("a rejected delete still closes the tab and only logs", async () => {
		const { client, log } = makeAgent("v3", "reject");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId });
		const warn = vi.fn();
		await retireClosedTabClient(client, tab.hook.result.current.snapshot(), warn);
		expect(log.at(-1)).toBe("disconnect");
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("[I259]"),
			expect.any(Error),
		);
	});

	it("a hung delete gives up after 1 s and closes the tab", async () => {
		vi.useFakeTimers();
		const { client, log } = makeAgent("v3", "hang");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId });
		const warn = vi.fn();
		const done = retireClosedTabClient(
			client,
			tab.hook.result.current.snapshot(),
			warn,
		);
		await vi.advanceTimersByTimeAsync(999);
		expect(log).not.toContain("disconnect");
		await vi.advanceTimersByTimeAsync(1);
		await done;
		expect(log.at(-1)).toBe("disconnect");
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("New chat on a hung delete still retires after 1 s", async () => {
		vi.useFakeTimers();
		const { client, log } = makeAgent("v3", "hang");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId });
		const done = newChat(tab, client);
		await vi.advanceTimersByTimeAsync(1000);
		await done;
		expect(log.at(-1)).toBe("session/close sess_1");
	});
});

describe("I259 — idle release", () => {
	function release(
		client: AcpClient,
		tab: ReturnType<typeof mountTab>,
		opts: {
			recheck?: () => boolean;
			lazyRelease?: () => boolean;
			agentRejects?: boolean;
			onReleased?: (newSessionGate: ReturnType<typeof createReleaseGate>) => void;
		} = {},
	) {
		const gate = createReleaseGate();
		const newSessionGate = createReleaseGate();
		const running = runIdleRelease({
			recheck: opts.recheck ?? (() => true),
			flush: async () => undefined,
			snapshotDiscard: () => {
				const snap = tab.hook.result.current.snapshot();
				return () => tab.hook.result.current.discard(snap);
			},
			lazyRelease:
				opts.lazyRelease ??
				(() => {
					// The tab is `released` from here: a keystroke may arrive.
					queueMicrotask(() => opts.onReleased?.(newSessionGate));
					return true;
				}),
			agentRelease: async () => {
				await client.disconnect();
				if (opts.agentRejects) throw new Error("teardown failed");
			},
			gate,
			newSessionGate,
		});
		return { running, gate, newSessionGate };
	}

	it("deletes the empty tab's session before the process is freed", async () => {
		const { client, log } = makeAgent("v3");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId });
		await release(client, tab).running;
		expect(log).toEqual(["session/new", "session/delete sess_1", "disconnect"]);
	});

	it("a keystroke during the delete starts its session only after disconnect", async () => {
		const { client, log } = makeAgent("v3");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId });
		let acquired: Promise<void> = Promise.resolve();
		const { running } = release(client, tab, {
			// acquireNewSession waits on newSessionGate, as loadExistingSession
			// waits on the full gate.
			onReleased: (newSessionGate) => {
				acquired = newSessionGate.wait().then(() => {
					log.push(
						client.isInitialized()
							? "new-session on OLD process"
							: "new-session on fresh process",
					);
				});
			},
		});
		await running;
		await acquired;
		expect(log).toEqual([
			"session/new",
			"session/delete sess_1",
			"disconnect",
			"new-session on fresh process",
		]);
	});

	it("a send landing during the flush prevents the delete", async () => {
		const { client, log } = makeAgent("v3");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId });
		let calls = 0;
		const ran = await release(client, tab, {
			recheck: () => {
				calls += 1;
				return calls === 1; // the send arrived while flushing
			},
		}).running;
		expect(ran).toBe(false);
		expect(log).toEqual(["session/new"]);
	});

	it("a refused release never holds the new-session gate", async () => {
		const { client } = makeAgent("v3");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId });
		const { running, newSessionGate } = release(client, tab, {
			lazyRelease: () => false,
		});
		expect(await running).toBe(false);
		await expect(newSessionGate.wait()).resolves.toBeUndefined();
	});

	it("a release that throws still opens the new-session gate", async () => {
		const { client } = makeAgent("v3");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId });
		const { running, newSessionGate } = release(client, tab, {
			agentRejects: true,
		});
		await expect(running).rejects.toThrow("teardown failed");
		await expect(newSessionGate.wait()).resolves.toBeUndefined();
	});
});

describe("I259 — idle release keeps a kept id (review B1)", () => {
	function realSteps(
		client: AcpClient,
		tab: ReturnType<typeof mountTab>,
		keep: boolean,
	) {
		const lazyRelease = vi.fn((_keep: boolean) => true);
		const resetSendAttempt = vi.fn();
		const steps = idleReleaseDiscardSteps({
			keepSessionId: () => keep,
			retirement: () => tab.hook.result.current,
			lazyRelease,
			resetSendAttempt,
		});
		const run = runIdleRelease({
			recheck: () => true,
			flush: async () => undefined,
			...steps,
			agentRelease: () => client.disconnect(),
			gate: createReleaseGate(),
			newSessionGate: createReleaseGate(),
		});
		return { run, lazyRelease, resetSendAttempt };
	}

	it("a New chat on a restored tab, released idle: the kept id is not deleted", async () => {
		// restoredSessionId stays set after New chat, so I237 keeps the new id
		// for the next keystroke's session/load.
		const { client, log } = makeAgent("v3");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId });
		const { run, lazyRelease } = realSteps(client, tab, true);
		await run;
		expect(lazyRelease).toHaveBeenCalledWith(true);
		expect(log).toEqual(["session/new", "disconnect"]);
	});

	it("an empty fresh tab, released idle: deleted, then the send attempt is forgotten", async () => {
		const { client, log } = makeAgent("v3");
		const { sessionId } = await client.newSession("/tmp");
		const tab = mountTab(client, { sessionId });
		const { run, lazyRelease, resetSendAttempt } = realSteps(client, tab, false);
		await run;
		expect(lazyRelease).toHaveBeenCalledWith(false);
		expect(resetSendAttempt).toHaveBeenCalledTimes(1);
		expect(log).toEqual(["session/new", "session/delete sess_1", "disconnect"]);
	});
});

describe("I259 — closed-tab record", () => {
	it("drops a deleted id so reopen-closed never loads it", () => {
		expect(
			closedTabSessionId({ kind: "delete", sessionId: "sess_1" }, "sess_1"),
		).toBeNull();
		expect(closedTabSessionId({ kind: "keep" }, "sess_1")).toBe("sess_1");
		expect(
			closedTabSessionId({ kind: "delete", sessionId: "sess_1" }, "sess_9"),
		).toBe("sess_9");
	});
});
