/**
 * I224 — reproduce-first: an Agent-view row must show the plugin's own title
 * for a session it has a local record of (a rename, an AI title), not the
 * agent's `session/list` title. Session History Source Model: "A server
 * session the plugin also has should still show its local title in the Agent
 * view."
 *
 * Two paths feed Agent-view rows:
 * - live: `useSessionHistory.fetchSessions("agent", cwd)` → `session/list`
 * - disconnected: the persisted metadata cache, which `useHistoryModal` hands
 *   to the modal as `agentSessionCache`.
 *
 * Restore looks the saved record up by session id only (ChatView), so the
 * row must too — otherwise the row and the restored tab disagree.
 *
 * Only the ports are faked (agent client, settings). The settings fake
 * filters `getSavedSessions(agentId, cwd)` the way SessionStorage does.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useSessionHistory } from "../useSessionHistory";
import { useHistoryModal } from "../useHistoryModal";
import { SessionHistoryModal } from "../../ui/SessionHistoryModal";
import type { SessionHistoryModalProps } from "../../ui/SessionHistoryModal";
import type { ISettingsAccess } from "../../services/settings-service";
import type { AcpClient } from "../../acp/acp-client";
import type {
	ChatSession,
	SavedSessionInfo,
	SessionInfo,
} from "../../types/session";
import type { UseAgentReturn } from "../useAgent";
import type { UseSessionHistoryReturn } from "../useSessionHistory";
import type { App } from "obsidian";

const AGENT_ID = "kiro-cli";
const VAULT = "/vault";

const agentRow = (sessionId: string, title?: string): SessionInfo => ({
	sessionId,
	cwd: VAULT,
	title,
	updatedAt: "2026-10-27T00:00:00Z",
});

const local = (
	sessionId: string,
	title: string,
	cwd = VAULT,
): SavedSessionInfo => ({
	sessionId,
	agentId: AGENT_ID,
	cwd,
	title,
	createdAt: "2026-10-27T00:00:00Z",
	updatedAt: "2026-10-27T00:00:00Z",
});

function filterSaved(
	saved: SavedSessionInfo[],
	agentId?: string,
	cwd?: string,
): SavedSessionInfo[] {
	return saved.filter(
		(s) => (!agentId || s.agentId === agentId) && (!cwd || s.cwd === cwd),
	);
}

const session = {
	sessionId: "sess_current",
	agentId: AGENT_ID,
	state: "ready",
	authMethods: [],
	capabilities: {
		listsSessions: true,
		restoresViaLoad: true,
		restoresViaResume: false,
		forks: false,
		closesSessions: false,
		reportsModels: false,
	},
} as unknown as ChatSession;

async function liveRows(
	agentSessions: SessionInfo[],
	saved: SavedSessionInfo[],
): Promise<SessionInfo[]> {
	const settings = {
		getSavedSessions: (agentId?: string, cwd?: string) =>
			filterSaved(saved, agentId, cwd),
		getSnapshot: () => ({ savedSessions: saved, agentSessionMetaCache: {} }),
		subscribe: vi.fn(() => () => {}),
	} as unknown as ISettingsAccess;
	const agentClient = {
		listSessions: vi.fn(async () => ({ sessions: agentSessions })),
	} as unknown as AcpClient;
	const hook = renderHook(() =>
		useSessionHistory({
			agentClient,
			session,
			settingsAccess: settings,
			cwd: VAULT,
			agentCwd: VAULT,
			onSessionLoad: vi.fn(),
		} as Parameters<typeof useSessionHistory>[0]),
	);
	await act(async () => {
		await hook.result.current.fetchSessions("agent", VAULT);
	});
	return hook.result.current.sessions;
}

const titleOf = (rows: SessionInfo[], id: string) =>
	rows.find((r) => r.sessionId === id)?.title;

describe("I224 — live Agent view shows the local title", () => {
	it("prefers a user rename over the agent's title", async () => {
		const rows = await liveRows(
			[agentRow("bravo", "Build Obsidian Agent Console Smoke Test")],
			[local("bravo", "I219 renamed BRAVO")],
		);
		expect(titleOf(rows, "bravo")).toBe("I219 renamed BRAVO");
	});

	it("finds the local record by session id even when its folder differs", async () => {
		const rows = await liveRows(
			[agentRow("alpha", "Fix Obsidian Vault Filter History")],
			[local("alpha", "Reply with ALPHA keyword", "/elsewhere")],
		);
		expect(titleOf(rows, "alpha")).toBe("Reply with ALPHA keyword");
	});

	it("keeps the agent's title when the plugin has no record", async () => {
		const rows = await liveRows(
			[agentRow("srv", "Kiro integration with Obsidian")],
			[],
		);
		expect(titleOf(rows, "srv")).toBe("Kiro integration with Obsidian");
	});

	it("drops a placeholder agent title (Kiro V3 untitled session)", async () => {
		const rows = await liveRows(
			[agentRow("srv", "<obsidian_system_instruction>")],
			[],
		);
		expect(titleOf(rows, "srv")).toBeUndefined();
	});
});

function makeHistory(): UseSessionHistoryReturn {
	return {
		sessions: [],
		loading: false,
		error: null,
		hasMore: false,
		capabilities: session.capabilities,
		localSessionIds: new Set<string>(),
		fetchSessions: vi.fn(async () => {}),
		loadMoreSessions: vi.fn(async () => {}),
		deleteSession: vi.fn(async () => {}),
		updateSessionTitle: vi.fn(async () => {}),
		loadSessionMessages: vi.fn(async () => null),
		invalidateCache: vi.fn(),
	} as unknown as UseSessionHistoryReturn;
}

function cachedRowsShownByModal(
	cached: SessionInfo[],
	saved: SavedSessionInfo[],
): SessionInfo[] {
	let captured: SessionHistoryModalProps | undefined;
	const openSpy = vi
		.spyOn(SessionHistoryModal.prototype, "open")
		.mockImplementation(function (this: SessionHistoryModal) {
			captured = (this as unknown as { props: SessionHistoryModalProps })
				.props;
		});
	const plugin = {
		app: {} as App,
		settingsService: {
			getSnapshot: () => ({
				sessionHistorySource: "agent",
				agentSessionMetaCache: {
					[AGENT_ID]: { sessions: cached, syncedAt: "2026-10-27T00:00:00Z" },
				},
				savedSessions: saved,
			}),
			getSavedSessions: (agentId?: string, cwd?: string) =>
				filterSaved(saved, agentId, cwd),
			updateSettings: vi.fn(async () => {}),
		},
		getAvailableAgents: () => [],
	} as unknown as Parameters<typeof useHistoryModal>[0];
	const agent = {
		clearMessages: vi.fn(),
		session: { agentId: AGENT_ID },
	} as unknown as UseAgentReturn;
	const { result, unmount } = renderHook(() =>
		useHistoryModal(plugin, agent, makeHistory(), VAULT, false, false),
	);
	act(() => {
		result.current.handleOpenHistory();
	});
	openSpy.mockRestore();
	unmount();
	return captured?.agentSessionCache?.sessions ?? [];
}

describe("I224 — disconnected Agent view (cached list) shows the local title", () => {
	it("overlays a user rename onto the cached row", () => {
		const rows = cachedRowsShownByModal(
			[agentRow("bravo", "Build Obsidian Agent Console Smoke Test")],
			[local("bravo", "I219 renamed BRAVO")],
		);
		expect(titleOf(rows, "bravo")).toBe("I219 renamed BRAVO");
	});

	it("keeps the cached agent title when the plugin has no record", () => {
		const rows = cachedRowsShownByModal(
			[agentRow("srv", "Kiro integration with Obsidian")],
			[],
		);
		expect(titleOf(rows, "srv")).toBe("Kiro integration with Obsidian");
	});
});
