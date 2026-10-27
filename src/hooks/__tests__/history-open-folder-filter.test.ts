/**
 * I219 — opening Session history on the Agent source must ask the agent for
 * THIS folder's sessions by default, not every workspace.
 *
 * Smoke report (2026-10-27, Kiro CLI V3, `ST-kiro-v3-s3`): the Agent source
 * listed 183 sessions — other vaults, headless runs, probes — because the
 * first fetch on open sent `session/list` with no cwd (`cwd: null` = every
 * workspace). The Local source deliberately keeps listing the whole local
 * store across vaults (Local-first tenet, #185), so its first fetch stays
 * unfiltered.
 *
 * Enters at the public hook API (`handleOpenHistory`) and asserts the fetch
 * request the runtime makes — the seam the bug lived at.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHistoryModal } from "../useHistoryModal";
import type { App } from "obsidian";
import type { UseAgentReturn } from "../useAgent";
import type { UseSessionHistoryReturn } from "../useSessionHistory";
import type { SessionListSource } from "../../resolvers/session-history-view";

const VAULT = "/vault";

function makePlugin(source: SessionListSource) {
	return {
		app: {} as App,
		settingsService: {
			getSnapshot: () => ({
				sessionHistorySource: source,
				agentSessionMetaCache: {},
			}),
			updateSettings: vi.fn(async () => {}),
		},
		getAvailableAgents: () => [],
	} as unknown as Parameters<typeof useHistoryModal>[0];
}

function makeAgent() {
	return {
		clearMessages: vi.fn(),
		session: { agentId: "test-agent" },
	} as unknown as UseAgentReturn;
}

function makeSessionHistory(listsSessions: boolean) {
	const fetchSessions = vi.fn(async () => {});
	const history = {
		sessions: [],
		loading: false,
		error: null,
		hasMore: false,
		capabilities: {
			listsSessions,
			restoresViaLoad: true,
			restoresViaResume: false,
			forks: false,
			reportsModels: false,
		},
		canShowSessionHistory: true,
		canRestore: true,
		canFork: false,
		canList: listsSessions,
		isUsingLocalSessions: !listsSessions,
		localSessionIds: new Set<string>(),
		fetchSessions,
		loadMoreSessions: vi.fn(async () => {}),
		restoreSession: vi.fn(async () => {}),
		forkSession: vi.fn(async () => {}),
		deleteSession: vi.fn(async () => {}),
		updateSessionTitle: vi.fn(async () => {}),
		saveSessionLocally: vi.fn(async () => {}),
		saveSessionMessages: vi.fn(),
		applySessionTitle: vi.fn(),
		loadSessionMessages: vi.fn(async () => null),
		invalidateCache: vi.fn(),
	} as unknown as UseSessionHistoryReturn;
	return { history, fetchSessions };
}

function openHistory(source: SessionListSource, listsSessions: boolean) {
	const { history, fetchSessions } = makeSessionHistory(listsSessions);
	const { result, unmount } = renderHook(() =>
		useHistoryModal(
			makePlugin(source),
			makeAgent(),
			history,
			VAULT,
			true,
			false,
		),
	);
	act(() => {
		result.current.handleOpenHistory();
	});
	unmount();
	return fetchSessions;
}

describe("I219 — first fetch on open honors the per-source folder default", () => {
	it("Agent source: asks the agent for this folder's sessions only", () => {
		const fetchSessions = openHistory("agent", true);
		expect(fetchSessions).toHaveBeenCalledTimes(1);
		expect(fetchSessions).toHaveBeenLastCalledWith("agent", VAULT);
	});

	it("Local source: still opens on the whole local store (every vault)", () => {
		const fetchSessions = openHistory("local", true);
		expect(fetchSessions).toHaveBeenLastCalledWith("local", undefined);
	});

	it("saved Agent choice on an agent that can't list: falls back to Local, unfiltered", () => {
		const fetchSessions = openHistory("agent", false);
		expect(fetchSessions).toHaveBeenLastCalledWith("agent", undefined);
	});
});
