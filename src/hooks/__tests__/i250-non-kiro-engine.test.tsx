/**
 * I250: a non-Kiro session has no Kiro engine.
 *
 * Before the fix, `AcpTypeConverter.toInitializeResult` set
 * `kiroEngine: "v2"` for every launch that wasn't V3, Claude included. The
 * value was copied into session state, and the next turn's
 * `SessionStore.recordTurnSave` (D2) wrote `kiroEngine: "v2"` on the Claude
 * record. The tab state took the same value through ChatPanel's kept-engine
 * ref. Session History Invariants § 2: a record says engine only when the
 * agent has one.
 *
 * Fix: the edge sets `kiroEngine` only when `kiroCli` is true (I247's check,
 * from the launch config, never the agent id). The session copies take an
 * init result's value as-is, so "no engine" replaces a stale one. The kept
 * engine for tab persistence goes through `resolveKeptKiroEngine`.
 *
 * Seams (R2, R4): the real converter, a real AcpClient and the real useAgent
 * hook (only `doInitialize`, the spawn, and the wire are stubbed); the real
 * useSessionHistory → SessionStore path with a faked settings port; the real
 * restore and reload flows. Literal expectations (R5).
 *
 * Red-first (R1): on main the edge returns "v2" for Claude, the copy sites
 * keep a stale "v2", the record gets "v2", and `resolveKeptKiroEngine` does
 * not exist.
 *
 * Spec: [[I250 Non-Kiro session records get a Kiro engine]].
 */

import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAgent } from "../useAgent";
import { useSessionHistory } from "../useSessionHistory";
import { useKeptKiroEngine } from "../useKeptKiroEngine";
import { AcpClient } from "../../acp/acp-client";
import { AcpTypeConverter } from "../../acp/type-converter";
import { deriveHeaderEngine } from "../../resolvers/header-agent";
import {
	decideEngineRestore,
	resolveKeptKiroEngine,
} from "../../resolvers/session-engine";
import { reconnectExistingSession } from "../loadExistingSessionFlow";
import { assertEngineCanResume } from "../reloadSessionFlow";
import {
	NO_AGENT_CAPABILITIES,
	type ChatSession,
	type SavedSessionInfo,
	type SessionResult,
} from "../../types/session";
import type { ChatMessage } from "../../types/chat";
import type AgentClientPlugin from "../../plugin";
import type { ISettingsAccess } from "../../services/settings-service";
import type { IVaultAccess } from "../../services/vault-service";
import type { IMentionService } from "../../utils/mention-parser";
import type * as acp from "@agentclientprotocol/sdk";

const AGENT = "test-agent";
const CWD = "/vault";

const RAW_INIT = {
	protocolVersion: 1,
	agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
} as unknown as acp.InitializeResponse;

const CLAUDE_INIT = {
	...RAW_INIT,
	agentInfo: { name: "@agentclientprotocol/claude-agent-acp", title: "Claude Agent", version: "0.57.0" },
} as unknown as acp.InitializeResponse;

function makeAgentSettings(command: string) {
	const settings: Record<string, unknown> = {
		defaultAgentId: AGENT,
		claude: { id: "claude", displayName: "Claude" },
		codex: { id: "codex", displayName: "Codex" },
		gemini: { id: "gemini", displayName: "Gemini" },
		kiro: { id: "kiro", displayName: "Kiro" },
		opencode: { id: "opencode-acp", displayName: "OpenCode" },
		customAgents: [
			{ id: AGENT, displayName: "Test Agent", command, args: ["acp"], env: [], engine: "v2" },
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

/** A real AcpClient whose spawn returns the real converter's result. */
function makeClient(rawInit: acp.InitializeResponse = RAW_INIT) {
	const plugin = {
		settings: { autoAllowPermissions: false, windowsWslMode: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	const client = new AcpClient(plugin);
	const internals = client as unknown as {
		currentConfig: unknown;
		currentAgentId: string | null;
		isInitializedFlag: boolean;
		doInitialize: (config: { kiroEngine?: "v3"; command: string }) => Promise<unknown>;
		requireConnection: () => unknown;
	};
	vi.spyOn(internals, "doInitialize").mockImplementation(async (config) => {
		internals.currentConfig = config;
		internals.currentAgentId = AGENT;
		internals.isInitializedFlag = true;
		return AcpTypeConverter.toInitializeResult(rawInit, config);
	});
	const request = vi.fn(async (method: string) =>
		method === "session/new" ? { sessionId: "s1" } : {},
	);
	vi.spyOn(internals, "requireConnection").mockReturnValue({ agent: { request } });
	return client;
}

function launchConfig(command: string, kiroEngine?: "v3") {
	return {
		id: AGENT, displayName: "Test Agent", command, args: ["acp"],
		env: [], workingDirectory: CWD, ...(kiroEngine ? { kiroEngine } : {}),
	} as unknown as Parameters<AcpClient["initialize"]>[0];
}

const vault = {} as IVaultAccess & IMentionService;

/**
 * A tab whose session already carries a Kiro V2 engine (createSession on a
 * kiro-cli process), after which the same client re-initializes as Claude.
 * The cached init result is then Claude's; the session still holds "v2".
 */
async function tabWithStaleEngine() {
	const client = makeClient();
	const internals = client as unknown as {
		doInitialize: (config: { kiroEngine?: "v3"; command: string }) => Promise<unknown>;
	};
	const hook = renderHook(() =>
		useAgent(client, makeAgentSettings("kiro-cli"), vault, CWD, AGENT),
	);
	await act(async () => {
		await hook.result.current.createSession();
	});
	expect(hook.result.current.session.kiroEngine).toBe("v2");
	vi.mocked(internals.doInitialize).mockImplementation(async () =>
		AcpTypeConverter.toInitializeResult(CLAUDE_INIT, { command: "claude-agent-acp" }),
	);
	await client.initialize(launchConfig("claude-agent-acp"));
	expect(client.getInitializeResult()?.kiroCli).toBe(false);
	return { hook, client };
}

// ---------------------------------------------------------------------------
// 1. acp edge
// ---------------------------------------------------------------------------

describe("I250 acp edge: kiroEngine only for a kiro-cli process", () => {
	it("Claude gets no engine", () => {
		const init = AcpTypeConverter.toInitializeResult(CLAUDE_INIT, {
			command: "claude-agent-acp",
		});
		expect(init.kiroEngine).toBeUndefined();
		expect(init.kiroCli).toBe(false);
	});

	it("a launch with no command gets no engine", () => {
		expect(AcpTypeConverter.toInitializeResult(RAW_INIT, {}).kiroEngine).toBeUndefined();
	});

	it("kiro-cli and kiro-cli-chat on V2 get v2", () => {
		for (const command of ["kiro-cli", "/Users/me/.toolbox/bin/kiro-cli-chat", "C:\\tools\\kiro-cli.exe"]) {
			expect(AcpTypeConverter.toInitializeResult(RAW_INIT, { command }).kiroEngine).toBe("v2");
		}
	});

	it("any V3 launch gets v3", () => {
		expect(
			AcpTypeConverter.toInitializeResult(RAW_INIT, { command: "kiro-cli", kiroEngine: "v3" }).kiroEngine,
		).toBe("v3");
		expect(
			AcpTypeConverter.toInitializeResult(RAW_INIT, { command: "/opt/wrappers/my-kiro", kiroEngine: "v3" }).kiroEngine,
		).toBe("v3");
	});

	// Accepted gap (I271): a wrapper command on V2 isn't recognized as kiro-cli.
	it("a wrapper command on V2 gets no engine (I271 accepted gap)", () => {
		const init = AcpTypeConverter.toInitializeResult(RAW_INIT, { command: "/opt/wrappers/my-kiro" });
		expect(init.kiroEngine).toBeUndefined();
		expect(init.kiroCli).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 2. session copy sites
// ---------------------------------------------------------------------------

describe("I250 session state: a Claude init replaces a stale engine", () => {
	it("createSession reading the cached Claude init", async () => {
		const { hook } = await tabWithStaleEngine();
		await act(async () => {
			await hook.result.current.createSession();
		});
		expect(hook.result.current.session.kiroCli).toBe(false);
		expect(hook.result.current.session.kiroEngine).toBeUndefined();
	});

	it("updateSessionFromLoad reading the cached Claude init", async () => {
		const { hook } = await tabWithStaleEngine();
		await act(async () => {
			await hook.result.current.updateSessionFromLoad("s1", undefined, undefined, undefined);
		});
		expect(hook.result.current.session.kiroEngine).toBeUndefined();
	});

	it("applyInitCapabilities reading the cached Claude init", async () => {
		const { hook } = await tabWithStaleEngine();
		act(() => hook.result.current.applyInitCapabilities());
		expect(hook.result.current.session.kiroEngine).toBeUndefined();
	});

	it("Kiro V2 and V3 still carry their engine", async () => {
		for (const [cmd, engine, want] of [
			["kiro-cli", undefined, "v2"],
			["kiro-cli", "v3", "v3"],
		] as const) {
			const client = makeClient();
			await client.initialize(launchConfig(cmd, engine));
			const hook = renderHook(() =>
				useAgent(client, makeAgentSettings(cmd), vault, CWD, AGENT),
			);
			act(() => hook.result.current.applyInitCapabilities());
			expect(hook.result.current.session.kiroEngine).toBe(want);
		}
	});
});

// ---------------------------------------------------------------------------
// 3. turn save through the single writer
// ---------------------------------------------------------------------------

function makeHistorySettings() {
	let savedSessions: SavedSessionInfo[] = [];
	const api = {
		getSavedSessions: () => savedSessions,
		getSnapshot: () => ({ savedSessions }),
		saveSession: vi.fn(async (info: SavedSessionInfo) => {
			savedSessions = [
				...savedSessions.filter((s) => s.sessionId !== info.sessionId),
				info,
			];
		}),
		saveSessionMessages: vi.fn(async () => {}),
		loadSessionMessages: vi.fn(async () => null),
		loadSessionContextNotes: vi.fn(async () => null),
		subscribe: vi.fn(() => () => {}),
		get saved() {
			return savedSessions;
		},
	};
	return api as unknown as ISettingsAccess & typeof api;
}

const TURN: ChatMessage[] = [
	{ id: "u", role: "user", content: [{ type: "text", text: "hello" }], timestamp: new Date() },
	{ id: "a", role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: new Date() },
];

/** Session state for `command`, built from the real edge. */
function sessionFor(command: string, kiroEngine?: "v3"): ChatSession {
	const init = AcpTypeConverter.toInitializeResult(RAW_INIT, { command, kiroEngine });
	return {
		sessionId: "sess_1",
		agentId: AGENT,
		state: "ready",
		authMethods: [],
		capabilities: init.capabilities,
		kiroEngine: init.kiroEngine,
		kiroCli: init.kiroCli,
	} as unknown as ChatSession;
}

async function saveTurn(session: ChatSession) {
	const settings = makeHistorySettings();
	const hook = renderHook(() =>
		useSessionHistory({
			agentClient: { getLaunchKey: () => null } as unknown as AcpClient,
			session,
			settingsAccess: settings,
			cwd: CWD,
			agentCwd: CWD,
			onSessionLoad: vi.fn(),
		} as Parameters<typeof useSessionHistory>[0]),
	);
	await act(async () => {
		await hook.result.current.saveSessionMessages("sess_1", TURN);
		await new Promise((r) => setTimeout(r, 0));
	});
	return settings.saved[0];
}

describe("I250 turn save: the record says engine only for Kiro", () => {
	it("a Claude turn writes no engine", async () => {
		const record = await saveTurn(sessionFor("claude-agent-acp"));
		expect(record).toBeDefined();
		expect("kiroEngine" in record).toBe(false);
	});

	it("a Kiro V2 turn writes v2, a Kiro V3 turn writes v3", async () => {
		expect((await saveTurn(sessionFor("kiro-cli"))).kiroEngine).toBe("v2");
		expect((await saveTurn(sessionFor("kiro-cli", "v3"))).kiroEngine).toBe("v3");
	});
});

// ---------------------------------------------------------------------------
// 4. kept engine for tab persistence
// ---------------------------------------------------------------------------

describe("I250 resolveKeptKiroEngine", () => {
	it("no session id: keeps the stored value", () => {
		expect(resolveKeptKiroEngine("v2", { sessionId: null, kiroCli: false, kiroEngine: undefined })).toBe("v2");
	});

	it("not initialized yet (kiroCli unknown): keeps the stored value", () => {
		expect(resolveKeptKiroEngine("v3", { sessionId: "s1", kiroCli: undefined, kiroEngine: undefined })).toBe("v3");
	});

	it("a live Claude session: no engine, replacing a restored v2", () => {
		expect(resolveKeptKiroEngine("v2", { sessionId: "s1", kiroCli: false, kiroEngine: undefined })).toBeUndefined();
	});

	it("a Kiro V3 tab switched to Claude: no engine", () => {
		expect(resolveKeptKiroEngine("v3", { sessionId: "s2", kiroCli: false, kiroEngine: undefined })).toBeUndefined();
	});

	it("a live Kiro session: its engine", () => {
		expect(resolveKeptKiroEngine(undefined, { sessionId: "s1", kiroCli: true, kiroEngine: "v3" })).toBe("v3");
		expect(resolveKeptKiroEngine("v3", { sessionId: "s1", kiroCli: true, kiroEngine: "v2" })).toBe("v2");
	});
});

// ---------------------------------------------------------------------------
// 5. restore, soft reload, header
// ---------------------------------------------------------------------------

function fakeReconnectClient(running: "v2" | "v3" | undefined) {
	const calls: string[] = [];
	let initialized = false;
	return {
		calls,
		client: {
			isInitialized: () => initialized,
			getInitializeResult: () =>
				initialized
					? { capabilities: { ...NO_AGENT_CAPABILITIES, restoresViaLoad: true }, kiroEngine: running }
					: null,
			loadSession: vi.fn(async (sid: string): Promise<SessionResult> => {
				calls.push(`load:${sid}`);
				return { sessionId: sid, replayedConversationUpdates: 1 } as SessionResult;
			}),
			resumeSession: vi.fn(async (sid: string): Promise<SessionResult> => ({ sessionId: sid })),
		},
		initialize: vi.fn(async () => {
			initialized = true;
		}),
	};
}

describe("I250 restore and reload read a missing engine as unknown", () => {
	it("a legacy Claude record with v2 loads on a Claude process (no engine)", async () => {
		const c = fakeReconnectClient(undefined);
		const result = await reconnectExistingSession({
			sessionId: "claude-1",
			cwd: CWD,
			client: c.client,
			initialize: c.initialize,
			haveLocalHistory: () => false,
			onLoaded: () => {},
			setIgnoreUpdates: () => {},
			storedEngine: "v2",
		});
		expect(result.ok).toBe(true);
		expect(c.calls).toEqual(["load:claude-1"]);
	});

	it("a Kiro V3 chat on a Kiro V2 process still starts fresh", () => {
		expect(decideEngineRestore({ stored: "v3", running: "v2" }).kind).toBe("start-fresh");
	});

	it("soft reload of a Claude tab with a legacy v2 does not throw", () => {
		expect(() => assertEngineCanResume("v2", undefined)).not.toThrow();
	});

	it("header: Claude shows its reported engine; Kiro V2 and V3 unchanged", () => {
		const claude = AcpTypeConverter.toInitializeResult(CLAUDE_INIT, { command: "claude-agent-acp" });
		expect(deriveHeaderEngine(claude)).toEqual({ kind: "reported", label: "Claude Agent 0.57.0" });
		const v2 = AcpTypeConverter.toInitializeResult(RAW_INIT, { command: "kiro-cli" });
		expect(deriveHeaderEngine(v2)).toEqual({ kind: "kiroCli", engine: "v2" });
		const v3 = AcpTypeConverter.toInitializeResult(RAW_INIT, { command: "kiro-cli", kiroEngine: "v3" });
		expect(deriveHeaderEngine(v3)).toEqual({ kind: "kiroCli", engine: "v3" });
	});
});

// ---------------------------------------------------------------------------
// 6. review follow-ups: the ChatPanel hook, cross-agent restart, end to end
// ---------------------------------------------------------------------------

describe("I250 useKeptKiroEngine (ChatPanel's tab-persistence engine)", () => {
	it("a restored v2 tab that connects as Claude persists no engine", () => {
		const hook = renderHook(
			(live: { sessionId: string | null; kiroCli?: boolean; kiroEngine?: "v2" | "v3" }) =>
				useKeptKiroEngine("v2", {
					sessionId: live.sessionId,
					kiroCli: live.kiroCli,
					kiroEngine: live.kiroEngine,
				}),
			{ initialProps: { sessionId: "claude-1" } as { sessionId: string | null; kiroCli?: boolean; kiroEngine?: "v2" | "v3" } },
		);
		expect(hook.result.current.current).toBe("v2");
		hook.rerender({ sessionId: "claude-1", kiroCli: false, kiroEngine: undefined });
		expect(hook.result.current.current).toBeUndefined();
	});

	it("a released Kiro tab keeps its engine while no session is live", () => {
		const hook = renderHook(
			(live: { sessionId: string | null; kiroCli?: boolean; kiroEngine?: "v2" | "v3" }) =>
				useKeptKiroEngine(undefined, {
					sessionId: live.sessionId,
					kiroCli: live.kiroCli,
					kiroEngine: live.kiroEngine,
				}),
			{ initialProps: { sessionId: "k1", kiroCli: true, kiroEngine: "v3" } as { sessionId: string | null; kiroCli?: boolean; kiroEngine?: "v2" | "v3" } },
		);
		expect(hook.result.current.current).toBe("v3");
		hook.rerender({ sessionId: null, kiroCli: true, kiroEngine: "v3" });
		expect(hook.result.current.current).toBe("v3");
	});
});

describe("I250 cross-agent restart doesn't carry the old engine", () => {
	it("Kiro V3 tab → New chat with another agent whose start fails: no engine", async () => {
		const client = makeClient();
		const internals = client as unknown as {
			doInitialize: (config: unknown) => Promise<unknown>;
		};
		const settings = makeAgentSettings("kiro-cli");
		const snap = settings.getSnapshot() as unknown as { customAgents: Record<string, unknown>[] };
		snap.customAgents[0].engine = "v3";
		snap.customAgents.push({ id: "test-agent-claude", displayName: "Other", command: "claude-agent-acp", args: [], env: [] });
		const hook = renderHook(() => useAgent(client, settings, vault, CWD, AGENT));
		await act(async () => {
			await hook.result.current.createSession();
		});
		expect(hook.result.current.session.kiroEngine).toBe("v3");
		vi.mocked(internals.doInitialize).mockRejectedValueOnce(new Error("spawn ENOENT"));
		await act(async () => {
			await hook.result.current.restartSession("test-agent-claude").catch(() => {});
		});
		expect(hook.result.current.session.agentId).toBe("test-agent-claude");
		expect(hook.result.current.session.state).toBe("error");
		expect(hook.result.current.session.kiroCli).toBeUndefined();
		expect(hook.result.current.session.kiroEngine).toBeUndefined();
	});

	it("restarting the same Kiro agent keeps its engine while it connects", async () => {
		const client = makeClient();
		const internals = client as unknown as {
			doInitialize: (config: unknown) => Promise<unknown>;
		};
		const settings = makeAgentSettings("kiro-cli");
		(settings.getSnapshot() as unknown as { customAgents: Record<string, unknown>[] }).customAgents[0].engine = "v3";
		const hook = renderHook(() => useAgent(client, settings, vault, CWD, AGENT));
		await act(async () => {
			await hook.result.current.createSession();
		});
		expect(hook.result.current.session.kiroEngine).toBe("v3");
		vi.mocked(internals.doInitialize).mockRejectedValueOnce(new Error("spawn ENOENT"));
		(client as unknown as { isInitializedFlag: boolean }).isInitializedFlag = false;
		await act(async () => {
			await hook.result.current.restartSession().catch(() => {});
		});
		expect(hook.result.current.session.state).toBe("error");
		expect(hook.result.current.session.kiroCli).toBe(true);
		expect(hook.result.current.session.kiroEngine).toBe("v3");
	});
});

describe("I250 end to end: a Claude useAgent turn saves a record with no engine", () => {
	it("useAgent session → useSessionHistory → savedSessions", async () => {
		const agentHook = renderHook(() =>
			useAgent(makeClient(CLAUDE_INIT), makeAgentSettings("claude-agent-acp"), vault, CWD, AGENT),
		);
		await act(async () => {
			await agentHook.result.current.createSession();
		});
		const live = agentHook.result.current.session;
		expect(live.sessionId).toBe("s1");
		const settings = makeHistorySettings();
		const hook = renderHook(() =>
			useSessionHistory({
				agentClient: { getLaunchKey: () => null } as unknown as AcpClient,
				session: live,
				settingsAccess: settings,
				cwd: CWD,
				agentCwd: CWD,
				onSessionLoad: vi.fn(),
			} as Parameters<typeof useSessionHistory>[0]),
		);
		await act(async () => {
			await hook.result.current.saveSessionMessages("s1", TURN);
			await new Promise((r) => setTimeout(r, 0));
		});
		expect(settings.saved[0]?.sessionId).toBe("s1");
		expect("kiroEngine" in settings.saved[0]).toBe(false);
	});
});
