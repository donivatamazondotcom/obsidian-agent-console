/**
 * I275 — "Only this folder" must filter on the folder the agent runs in, not
 * the vault-root baseline.
 *
 * Smoke report (2026-11-02, Claude Code, `ST-i268-claude-replay-context`): on
 * a connected Claude tab the Agent view opened on "No previous sessions" with
 * the filter checked, while the unfiltered list held this folder's sessions
 * with the exact cwd. The agent's filter was fine (raw `session/list` with the
 * exact folder returned those rows); the plugin asked for the wrong folder.
 * `ChatPanel` keeps two values — `agentCwd` (what the agent stamps on its
 * sessions; follows the per-agent default, "New chat in directory" and an
 * agent switch) and `vaultPath` (the global baseline) — and handed the modal
 * the baseline.
 *
 * Enters at the public hook API with a folder that differs from the vault
 * root and asserts the two places the folder reaches the runtime: the first
 * `session/list` request on open, and the `currentCwd` the modal renders and
 * narrows on. A caller that passes the vault root fails both.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHistoryModal } from "../useHistoryModal";
import type { App } from "obsidian";
import type { UseAgentReturn } from "../useAgent";
import type { UseSessionHistoryReturn } from "../useSessionHistory";

const VAULT_ROOT = "/vault";
const AGENT_FOLDER = "/vault/sub/project";

const updateProps = vi.fn();
const open = vi.fn();
vi.mock("../../ui/SessionHistoryModal", () => ({
	SessionHistoryModal: class {
		constructor(_app: App, _props: unknown, _onClose: () => void) {}
		open = open;
		updateProps = updateProps;
		close = vi.fn();
	},
}));

function makePlugin() {
	return {
		app: {} as App,
		settingsService: {
			getSnapshot: () => ({
				sessionHistorySource: "agent",
				agentSessionMetaCache: {},
			}),
			getSavedSessions: () => [],
			updateSettings: vi.fn(async () => {}),
		},
		getAvailableAgents: () => [],
	} as unknown as Parameters<typeof useHistoryModal>[0];
}

function makeAgent() {
	return {
		clearMessages: vi.fn(),
		session: { agentId: "claude-code-acp" },
	} as unknown as UseAgentReturn;
}

function makeSessionHistory() {
	const fetchSessions = vi.fn(async () => {});
	const caps = {
		listsSessions: true,
		restoresViaLoad: true,
		restoresViaResume: false,
		forks: false,
		reportsModels: false,
	};
	const history = {
		sessions: [],
		loading: false,
		error: null,
		hasMore: false,
		capabilities: caps,
		historyCapabilities: { kind: "live", capabilities: caps },
		canShowSessionHistory: true,
		canRestore: true,
		canFork: false,
		canList: true,
		isUsingLocalSessions: false,
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

/** What ChatPanel hands the hook as the folder, given the tab's two values. */
function openWithFolder(folder: string) {
	const { history, fetchSessions } = makeSessionHistory();
	const { result, rerender, unmount } = renderHook(() =>
		useHistoryModal(makePlugin(), makeAgent(), history, folder, true, false),
	);
	act(() => {
		result.current.handleOpenHistory();
	});
	rerender();
	const rendered = updateProps.mock.calls.at(-1)?.[0] as
		| { currentCwd: string }
		| undefined;
	unmount();
	return { fetchSessions, rendered };
}

describe("I275 — the history folder is the agent's folder, not the vault root", () => {
	it("first Agent-view fetch on open asks for the agent's folder", () => {
		const { fetchSessions } = openWithFolder(AGENT_FOLDER);
		expect(fetchSessions).toHaveBeenCalledTimes(1);
		expect(fetchSessions).toHaveBeenLastCalledWith("agent", AGENT_FOLDER);
		expect(fetchSessions).not.toHaveBeenCalledWith("agent", VAULT_ROOT);
	});

	it("the modal narrows and labels on the same folder it fetched", () => {
		const { rendered } = openWithFolder(AGENT_FOLDER);
		expect(rendered?.currentCwd).toBe(AGENT_FOLDER);
	});

	it("a caller passing the vault-root baseline is the I275 bug (guard)", () => {
		// Pins the failure shape: with the baseline, the filter asks for a
		// folder the agent's sessions are not in.
		const { fetchSessions } = openWithFolder(VAULT_ROOT);
		expect(fetchSessions).toHaveBeenLastCalledWith("agent", VAULT_ROOT);
		expect(fetchSessions).not.toHaveBeenCalledWith("agent", AGENT_FOLDER);
	});
});
