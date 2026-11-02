/**
 * I209 — the release sequence and the reconnect gate (spec § 4, § 6 tests 4
 * and 7).
 *
 * Order, all awaited: re-check → flush the transcript save → lazy release
 * (UI goes `released` before the process dies) → agent release (disconnect,
 * then wait for the tree to EXIT). A reconnect that starts while a release is
 * in flight waits on the gate, which settles on tree exit — not when
 * `disconnect()` returns — because Kiro V2 rejects session/load while the old
 * process still holds the session (I230). A deliberate release shows no
 * connection-lost error.
 *
 * Seams (R2): `runIdleRelease` + `createReleaseGate` (the functions ChatPanel
 * composes), and the public `useAgentSession.releaseSession` with only the
 * ACP client port faked (R4). Assertions on call order, session state and
 * error state (R3). Literals (R5).
 *
 * Spec: [[I209 Idle tabs never release their agent process]].
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
	createReleaseGate,
	runIdleRelease,
	useApplyAfterReconnect,
} from "../useIdleRelease";
import { useAgentSession } from "../useAgentSession";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";
import { AcpClient as RealAcpClient } from "../../acp/acp-client";
import type AgentClientPlugin from "../../plugin";

function deferred() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

describe("I209 runIdleRelease", () => {
	it("flushes before the lazy release, and the lazy release before the agent release", async () => {
		const calls: string[] = [];
		const gate = createReleaseGate();
		const ran = await runIdleRelease({
			recheck: () => {
				calls.push("recheck");
				return true;
			},
			flush: async () => {
				calls.push("flush");
			},
			lazyRelease: () => {
				calls.push("lazy-release");
				return true;
			},
			agentRelease: async () => {
				calls.push("agent-release");
			},
			gate,
		});
		expect(ran).toBe(true);
		expect(calls).toEqual(["recheck", "flush", "recheck", "lazy-release", "agent-release"]);
	});

	it("stops after the flush when work started meanwhile", async () => {
		const calls: string[] = [];
		let n = 0;
		const ran = await runIdleRelease({
			recheck: () => {
				n += 1;
				return n === 1;
			},
			flush: async () => {
				calls.push("flush");
			},
			lazyRelease: () => {
				calls.push("lazy-release");
				return true;
			},
			agentRelease: async () => {
				calls.push("agent-release");
			},
			gate: createReleaseGate(),
		});
		expect(ran).toBe(false);
		expect(calls).toEqual(["flush"]);
	});

	it("does not kill the process when the lazy owner refuses", async () => {
		const agentRelease = vi.fn(async () => {});
		const ran = await runIdleRelease({
			recheck: () => true,
			flush: async () => {},
			lazyRelease: () => false,
			agentRelease,
			gate: createReleaseGate(),
		});
		expect(ran).toBe(false);
		expect(agentRelease).not.toHaveBeenCalled();
	});

	it("a reconnect during the release waits until the tree has exited", async () => {
		const gate = createReleaseGate();
		const treeExit = deferred();
		const calls: string[] = [];
		const releasing = runIdleRelease({
			recheck: () => true,
			flush: async () => {},
			lazyRelease: () => true,
			agentRelease: () => treeExit.promise.then(() => {
				calls.push("tree-exited");
			}),
			gate,
		});
		await Promise.resolve();
		const reconnect = gate.wait().then(() => calls.push("reconnect"));
		await Promise.resolve();
		await Promise.resolve();
		expect(calls).toEqual([]);
		treeExit.resolve();
		await releasing;
		await reconnect;
		expect(calls).toEqual(["tree-exited", "reconnect"]);
	});

	it("the gate is open when nothing is releasing", async () => {
		const gate = createReleaseGate();
		let passed = false;
		await gate.wait().then(() => {
			passed = true;
		});
		expect(passed).toBe(true);
	});

	it("a failed agent release still opens the gate", async () => {
		const gate = createReleaseGate();
		await expect(
			runIdleRelease({
				recheck: () => true,
				flush: async () => {},
				lazyRelease: () => true,
				agentRelease: async () => {
					throw new Error("kill failed");
				},
				gate,
			}),
		).rejects.toThrow("kill failed");
		let passed = false;
		await gate.wait().then(() => {
			passed = true;
		});
		expect(passed).toBe(true);
	});
});

// ----------------------------------------------------------------------------
// useAgentSession.releaseSession
// ----------------------------------------------------------------------------

const AGENT = "test-agent";

function makeClient() {
	const calls: string[] = [];
	const treeExit = deferred();
	const agentClient = {
		isInitialized: () => true,
		getCurrentAgentId: () => AGENT,
		initialize: vi.fn(async () => ({})),
		newSession: vi.fn(async () => ({
			sessionId: "s1",
			modes: {
				currentModeId: "code",
				availableModes: [{ id: "code", name: "Code" }],
			},
			models: {
				currentModelId: "m1",
				availableModels: [{ modelId: "m1", name: "Model 1" }],
			},
			configOptions: undefined,
		})),
		disconnect: vi.fn(async () => {
			calls.push("disconnect");
		}),
		whenTornDown: vi.fn(() =>
			treeExit.promise.then(() => {
				calls.push("tree-exited");
			}),
		),
		cancel: vi.fn(async () => {
			calls.push("cancel");
		}),
		getInitializeResult: () => null,
		setSessionConfigOption: vi.fn(async () => []),
		setSessionModel: vi.fn(async () => {}),
		setSessionMode: vi.fn(async () => {}),
	} as unknown as AcpClient;
	return { agentClient, calls, treeExit };
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

describe("I209 useAgentSession.releaseSession", () => {
	it("resolves on tree exit, not when disconnect() returns", async () => {
		const { agentClient, calls, treeExit } = makeClient();
		const { result } = renderHook(() =>
			useAgentSession(agentClient, makeSettingsAccess(), "/cwd", () => {}, AGENT),
		);
		await act(async () => {
			await result.current.createSession();
		});
		let settled = false;
		let releasing: Promise<void> = Promise.resolve();
		await act(async () => {
			releasing = result.current.releaseSession().then(() => {
				settled = true;
			});
			await Promise.resolve();
		});
		expect(calls).toEqual(["disconnect"]);
		expect(settled).toBe(false);
		await act(async () => {
			treeExit.resolve();
			await releasing;
		});
		expect(calls).toEqual(["disconnect", "tree-exited"]);
		expect(settled).toBe(true);
	});

	it("clears the session id, keeps last-known models and modes, raises no error", async () => {
		const { agentClient, treeExit } = makeClient();
		const setErrorInfo = vi.fn();
		const { result } = renderHook(() =>
			useAgentSession(agentClient, makeSettingsAccess(), "/cwd", setErrorInfo, AGENT),
		);
		await act(async () => {
			await result.current.createSession();
		});
		expect(result.current.session.sessionId).toBe("s1");
		treeExit.resolve();
		await act(async () => {
			await result.current.releaseSession();
		});
		expect(result.current.session.sessionId).toBeNull();
		expect(result.current.session.state).toBe("disconnected");
		expect(result.current.session.models?.currentModelId).toBe("m1");
		expect(result.current.session.modes?.currentModeId).toBe("code");
		// No error was raised at any point (only clears to null).
		expect(setErrorInfo.mock.calls.every(([e]) => e === null)).toBe(true);
		// Nothing is in flight on an idle tab; release must not send cancel.
		expect(agentClient.cancel).not.toHaveBeenCalled();
	});
});

// ----------------------------------------------------------------------------
// AcpClient: live terminals + no connection-lost reconcile on a deliberate release
// ----------------------------------------------------------------------------

type ClientInternals = {
	agentProcess: unknown;
	connection: unknown;
	isInitializedFlag: boolean;
	terminalManager: { terminals: Map<string, { exitStatus: unknown }> };
	reconcileProcessGone: (proc: unknown) => void;
	killProcessTree: () => void;
	cancelAllOperations: () => void;
};

function realClient() {
	const plugin = {
		settings: { autoAllowPermissions: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	return new RealAcpClient(plugin);
}

describe("I209 AcpClient", () => {
	it("hasLiveTerminals is true only while a terminal is still running", () => {
		const client = realClient();
		const c = client as unknown as ClientInternals;
		expect(client.hasLiveTerminals()).toBe(false);
		c.terminalManager.terminals.set("t1", { exitStatus: null });
		expect(client.hasLiveTerminals()).toBe(true);
		c.terminalManager.terminals.set("t1", {
			exitStatus: { exitCode: 0, signal: null },
		});
		expect(client.hasLiveTerminals()).toBe(false);
	});

	it("the released process's late exit does not run the connection-lost reconcile", async () => {
		const client = realClient();
		const c = client as unknown as ClientInternals;
		const oldProc = { pid: 4242 };
		vi.spyOn(c, "killProcessTree").mockImplementation(() => {
			c.agentProcess = null;
		});
		const cancelAll = vi.spyOn(c, "cancelAllOperations");
		c.agentProcess = oldProc;
		c.connection = { agent: {} };
		c.isInitializedFlag = true;
		await client.disconnect();
		cancelAll.mockClear();
		// The old process's 'close' event arrives after the deliberate release.
		c.reconcileProcessGone(oldProc);
		expect(cancelAll).not.toHaveBeenCalled();
	});
});

// ----------------------------------------------------------------------------
// A model / mode / option pick on a released tab: reconnect first, then apply
// ----------------------------------------------------------------------------

describe("I209 useApplyAfterReconnect", () => {
	it("applies at once on a live tab", () => {
		const reconnect = vi.fn(async () => {});
		const apply = vi.fn();
		const { result } = renderHook(() =>
			useApplyAfterReconnect({ released: false, live: true, reconnect }),
		);
		act(() => result.current(apply));
		expect(apply).toHaveBeenCalledTimes(1);
		expect(reconnect).not.toHaveBeenCalled();
	});

	it("on a released tab, reconnects and applies once the session is live", () => {
		const reconnect = vi.fn(async () => {});
		const apply = vi.fn();
		const { result, rerender } = renderHook(
			(p: { released: boolean; live: boolean }) =>
				useApplyAfterReconnect({ ...p, reconnect }),
			{ initialProps: { released: true, live: false } },
		);
		act(() => result.current(apply));
		expect(reconnect).toHaveBeenCalledTimes(1);
		expect(apply).not.toHaveBeenCalled();
		rerender({ released: false, live: false }); // connecting
		expect(apply).not.toHaveBeenCalled();
		rerender({ released: false, live: true });
		expect(apply).toHaveBeenCalledTimes(1);
		rerender({ released: false, live: true });
		expect(apply).toHaveBeenCalledTimes(1);
	});

	it("the latest pick wins when two are made before the reconnect lands", () => {
		const reconnect = vi.fn(async () => {});
		const first = vi.fn();
		const second = vi.fn();
		const { result, rerender } = renderHook(
			(p: { released: boolean; live: boolean }) =>
				useApplyAfterReconnect({ ...p, reconnect }),
			{ initialProps: { released: true, live: false } },
		);
		act(() => result.current(first));
		act(() => result.current(second));
		rerender({ released: false, live: true });
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});
});
