/**
 * Session History Source Model — unified local store (Track 1).
 *
 * These tests guard the motivating fix: the Local view is the canonical "your
 * history" across EVERY agent (including plugin-created forks and disk-only
 * restores), independent of what any agent's `session/list` returns.
 *
 * THE REGRESSION GUARD (Session History Source Model § Approach step 4):
 * a plugin-created fork appears in the Local view for a LISTING agent (Claude).
 * Reproduce-first context — this encodes the I121-smoke failure (2026-06-27):
 * under the old agent-centric data path, a Claude tab listed sessions from the
 * agent's `session/list`, which never returns ACP forks, so a fork created by
 * the plugin was invisible. The fix (default-Local + drop the per-agent
 * filter) is what makes this test pass; against the old agent-source-for-Claude
 * behavior the fork is absent (covered by the contrast test below).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSessionHistory } from "../useSessionHistory";
import type { ISettingsAccess } from "../../services/settings-service";
import type { AcpClient } from "../../acp/acp-client";
import type {
	ChatSession,
	SavedSessionInfo,
	AgentCapabilities,
	ListSessionsResult,
} from "../../types/session";

const NOW = "2026-06-28T00:00:00.000Z";

const CLAUDE_CAPS: AgentCapabilities = {
	listsSessions: true,
	restoresViaLoad: true,
	restoresViaResume: false,
	forks: true,
	reportsModels: false,
};

function saved(
	sessionId: string,
	agentId: string,
	title: string,
	cwd = "/vault",
): SavedSessionInfo {
	return { sessionId, agentId, cwd, title, createdAt: NOW, updatedAt: NOW };
}

function makeSettings(savedSessions: SavedSessionInfo[]) {
	let snapshot = {
		savedSessions,
		sessionHistorySource: "local" as const,
		agentSessionMetaCache: {} as Record<string, unknown>,
	};
	const api = {
		// Emulate the real getSavedSessions filtering contract.
		getSavedSessions: vi.fn((agentId?: string, cwd?: string) => {
			let r = snapshot.savedSessions;
			if (agentId) r = r.filter((s) => s.agentId === agentId);
			if (cwd) r = r.filter((s) => s.cwd === cwd);
			return r;
		}),
		getSnapshot: () => snapshot,
		updateSettings: vi.fn(async (u: Record<string, unknown>) => {
			snapshot = { ...snapshot, ...u } as typeof snapshot;
		}),
		saveSession: vi.fn(async () => {}),
		saveSessionMessages: vi.fn(async () => {}),
		loadSessionMessages: vi.fn(async () => null),
		loadSessionContextNotes: vi.fn(async () => null),
		deleteSession: vi.fn(async () => {}),
		deleteSessionMessages: vi.fn(async () => {}),
		subscribe: vi.fn(() => () => {}),
	};
	return api as unknown as ISettingsAccess & typeof api;
}

function makeAgentClient(serverSessions: ListSessionsResult) {
	const api = {
		listSessions: vi.fn(async () => serverSessions),
		loadSession: vi.fn(),
		resumeSession: vi.fn(),
		forkSession: vi.fn(),
	};
	return api as unknown as AcpClient & typeof api;
}

function makeSession(agentId: string, capabilities: AgentCapabilities) {
	return {
		sessionId: null,
		state: "ready",
		agentId,
		agentDisplayName: agentId,
		authMethods: [],
		capabilities,
		createdAt: new Date(),
		lastActivityAt: new Date(),
		workingDirectory: "/vault",
	} as unknown as ChatSession;
}

function renderSessionHistory(opts: {
	savedSessions: SavedSessionInfo[];
	serverSessions: ListSessionsResult;
	agentId: string;
	capabilities: AgentCapabilities;
}) {
	const settings = makeSettings(opts.savedSessions);
	const agentClient = makeAgentClient(opts.serverSessions);
	const session = makeSession(opts.agentId, opts.capabilities);
	const hook = renderHook(() =>
		useSessionHistory({
			agentClient,
			session,
			settingsAccess: settings,
			cwd: "/vault",
			agentCwd: "/vault",
			onSessionLoad: vi.fn(),
		}),
	);
	return { hook, settings, agentClient };
}

describe("Session History Source Model — Local view (unified store)", () => {
	beforeEach(() => vi.clearAllMocks());

	it("REGRESSION: a plugin-created fork appears in the Local view for a listing agent (Claude)", async () => {
		// Claude lists sessions but its server list omits the plugin fork.
		const fork = saved("fork-1", "claude", "Fork: hi");
		const { hook, agentClient } = renderSessionHistory({
			savedSessions: [fork],
			serverSessions: { sessions: [] }, // server does NOT return the fork
			agentId: "claude",
			capabilities: CLAUDE_CAPS,
		});

		await act(async () => {
			await hook.result.current.fetchSessions("local");
		});

		// The fork is visible on the Local view…
		expect(
			hook.result.current.sessions.map((s) => s.sessionId),
		).toContain("fork-1");
		// …and the Local source never hits the agent's session/list.
		expect(agentClient.listSessions).not.toHaveBeenCalled();
	});

	it("CONTRAST: the Agent view uses the server session/list, which omits the plugin fork", async () => {
		const fork = saved("fork-1", "claude", "Fork: hi");
		const { hook, agentClient } = renderSessionHistory({
			savedSessions: [fork],
			serverSessions: { sessions: [] },
			agentId: "claude",
			capabilities: CLAUDE_CAPS,
		});

		await act(async () => {
			await hook.result.current.fetchSessions("agent");
		});

		expect(agentClient.listSessions).toHaveBeenCalled();
		expect(
			hook.result.current.sessions.map((s) => s.sessionId),
		).not.toContain("fork-1");
	});

	it("shows every agent's saved sessions (drops the per-agent filter), each tagged with its agentId", async () => {
		const { hook, settings } = renderSessionHistory({
			savedSessions: [
				saved("c1", "claude", "claude session"),
				saved("k1", "kiro", "kiro session"),
			],
			serverSessions: { sessions: [] },
			agentId: "claude", // the tab's agent — must NOT filter the list
			capabilities: CLAUDE_CAPS,
		});

		await act(async () => {
			await hook.result.current.fetchSessions("local");
		});

		const ids = hook.result.current.sessions.map((s) => s.sessionId);
		expect(ids).toEqual(expect.arrayContaining(["c1", "k1"]));
		// No per-agent filter argument passed (unified store).
		expect(settings.getSavedSessions).toHaveBeenCalledWith();
		// Rows carry their owning agentId for the badge + per-row resolution.
		expect(
			hook.result.current.sessions.find((s) => s.sessionId === "c1")
				?.agentId,
		).toBe("claude");
		expect(
			hook.result.current.sessions.find((s) => s.sessionId === "k1")
				?.agentId,
		).toBe("kiro");
	});

	it("a non-listing agent (Kiro) falls back to the unified Local store even when 'agent' is requested", async () => {
		const { hook, agentClient } = renderSessionHistory({
			savedSessions: [saved("k1", "kiro", "kiro session")],
			serverSessions: { sessions: [] },
			agentId: "kiro",
			capabilities: {
				listsSessions: false,
				restoresViaLoad: false,
				restoresViaResume: true,
				forks: false,
				reportsModels: false,
			},
		});

		await act(async () => {
			await hook.result.current.fetchSessions("agent");
		});

		expect(agentClient.listSessions).not.toHaveBeenCalled();
		expect(
			hook.result.current.sessions.map((s) => s.sessionId),
		).toContain("k1");
	});
});

describe("Session History Source Model — agent metadata cache", () => {
	beforeEach(() => vi.clearAllMocks());

	it("syncAgentSessionMetaCache mirrors the agent's session/list into the cache, keyed by agentId", async () => {
		const { hook, settings } = renderSessionHistory({
			savedSessions: [],
			serverSessions: {
				sessions: [
					{ sessionId: "s1", cwd: "/vault", title: "server one" },
				],
			},
			agentId: "claude",
			capabilities: CLAUDE_CAPS,
		});

		await act(async () => {
			await hook.result.current.syncAgentSessionMetaCache();
		});

		expect(settings.updateSettings).toHaveBeenCalledTimes(1);
		const arg = settings.updateSettings.mock.calls[0][0] as {
			agentSessionMetaCache: Record<
				string,
				{ sessions: { sessionId: string }[]; syncedAt: string }
			>;
		};
		expect(arg.agentSessionMetaCache.claude.sessions.map((s) => s.sessionId)).toEqual([
			"s1",
		]);
		expect(typeof arg.agentSessionMetaCache.claude.syncedAt).toBe("string");
	});

	it("does not sync for a non-listing agent (nothing to mirror)", async () => {
		const { hook, settings } = renderSessionHistory({
			savedSessions: [],
			serverSessions: { sessions: [] },
			agentId: "kiro",
			capabilities: {
				listsSessions: false,
				restoresViaLoad: false,
				restoresViaResume: true,
				forks: false,
				reportsModels: false,
			},
		});

		await act(async () => {
			await hook.result.current.syncAgentSessionMetaCache();
		});

		expect(settings.updateSettings).not.toHaveBeenCalled();
	});
});
