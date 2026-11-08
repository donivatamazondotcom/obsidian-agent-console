/**
 * I260 — a disconnected Claude Code tab can't open its Agent view.
 *
 * Smoke report (2026-11-01, `ST-i224-session-titles`): on a "Claude Code ·
 * Not connected" tab the Agent pill was disabled with the tooltip "Claude
 * Code doesn't keep a session list on its server". False: Claude Code lists
 * sessions and the vault held a 58-row offline copy of its list. Cause: before
 * `initialize` the tab has no capabilities, so `useSessionHistory` fell back
 * to the all-false record and the view read it as an agent that can't list.
 *
 * Enters at the runtime seam: the real `useSessionHistory` feeds the real
 * `useHistoryModal`, whose modal props render the real
 * `SessionHistoryContent`. Only the ports are faked (agent client, settings).
 * Session History Source Model Decision 1: a disconnected tab shows the
 * last-synced Agent list.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
	act,
	cleanup,
	fireEvent,
	render,
	renderHook,
	screen,
} from "@testing-library/react";
import type { App } from "obsidian";

import { useSessionHistory } from "../useSessionHistory";
import { useHistoryModal } from "../useHistoryModal";
import {
	SessionHistoryContent,
	SessionHistoryModal,
} from "../../ui/SessionHistoryModal";
import type { SessionHistoryModalProps } from "../../ui/SessionHistoryModal";
import type { ISettingsAccess } from "../../services/settings-service";
import type { AcpClient } from "../../acp/acp-client";
import type { AgentClientPluginSettings } from "../../plugin";
import type {
	AgentCapabilities,
	ChatSession,
	SessionInfo,
} from "../../types/session";
import type { UseAgentReturn } from "../useAgent";
import { DEFAULT_SETTINGS } from "../../services/settings-normalizer";
import { agentLaunchKey } from "../../utils/agent-launch-key";

const VAULT = "/vault";
const CLAUDE = DEFAULT_SETTINGS.claude;
const KIRO = DEFAULT_SETTINGS.kiro;

const LISTS: AgentCapabilities = {
	listsSessions: true,
	restoresViaLoad: true,
	restoresViaResume: false,
	forks: true,
	closesSessions: false,
	deletesSessions: false,
	reportsModels: false,
};
const NO_LIST: AgentCapabilities = {
	listsSessions: false,
	restoresViaLoad: false,
	restoresViaResume: true,
	forks: false,
	closesSessions: false,
	deletesSessions: false,
	reportsModels: false,
};

const offlineRow = (sessionId: string, title: string): SessionInfo => ({
	sessionId,
	cwd: VAULT,
	title,
	updatedAt: "2026-11-01T04:55:00Z",
});

interface Setup {
	agentId: string;
	kiroEngine?: "default" | "v2" | "v3";
	capabilityCache?: AgentClientPluginSettings["agentCapabilityCache"];
	metaRows?: SessionInfo[];
}

/** Open Session history on a tab that has never connected; render the modal. */
function openDisconnectedHistory(setup: Setup) {
	const settings: AgentClientPluginSettings = {
		...DEFAULT_SETTINGS,
		kiro: { ...KIRO, engine: setup.kiroEngine ?? "default" },
		sessionHistorySource: "local",
		agentCapabilityCache: setup.capabilityCache ?? {},
		serverSessionCache: setup.metaRows
			? {
					// I270: keyed by the launch a connect would make.
					[agentLaunchKey({
						command: setup.agentId === CLAUDE.id ? CLAUDE.command : KIRO.command,
						kiroEngine: setup.agentId === CLAUDE.id ? undefined : "v3",
					})]: {
						sessions: setup.metaRows,
						syncedAt: "2026-11-01T04:55:00Z",
					},
				}
			: {},
	};
	const updateSettings = vi.fn(async () => {});
	const settingsAccess = {
		getSnapshot: () => settings,
		getSavedSessions: () => [],
		subscribe: () => () => {},
		updateSettings,
	} as unknown as ISettingsAccess;
	const listSessions = vi.fn(async () => {
		throw new Error("Connection not initialized. Call initialize() first.");
	});
	const agentClient = {
		listSessions,
		getLaunchKey: () => null,
	} as unknown as AcpClient;
	// Never connected: no capabilities yet, not ready.
	const session = {
		sessionId: null,
		agentId: setup.agentId,
		state: "disconnected",
		authMethods: [],
	} as unknown as ChatSession;

	const history = renderHook(() =>
		useSessionHistory({
			agentClient,
			session,
			settingsAccess,
			cwd: VAULT,
			agentCwd: VAULT,
			onSessionLoad: vi.fn(),
		} as Parameters<typeof useSessionHistory>[0]),
	);

	let props: SessionHistoryModalProps | undefined;
	const openSpy = vi
		.spyOn(SessionHistoryModal.prototype, "open")
		.mockImplementation(function (this: SessionHistoryModal) {
			props = (this as unknown as { props: SessionHistoryModalProps })
				.props;
		});
	const plugin = {
		app: {} as App,
		settingsService: {
			getSnapshot: () => settings,
			getSavedSessions: () => [],
			updateSettings,
		},
		getAvailableAgents: () => [
			{ id: CLAUDE.id, displayName: CLAUDE.displayName },
			{ id: KIRO.id, displayName: KIRO.displayName },
		],
	} as unknown as Parameters<typeof useHistoryModal>[0];
	const agent = {
		clearMessages: vi.fn(),
		session,
	} as unknown as UseAgentReturn;
	const modal = renderHook(() =>
		useHistoryModal(plugin, agent, history.result.current, VAULT, false, false),
	);
	act(() => {
		modal.result.current.handleOpenHistory();
	});
	openSpy.mockRestore();
	modal.unmount();
	if (!props) throw new Error("history modal did not open");

	// Route the modal's fetches into the real hook, as the runtime does.
	const onFetchSessions = (source: "local" | "agent", cwd?: string) => {
		void history.result.current.fetchSessions(source, cwd);
	};
	render(
		<SessionHistoryContent
			{...props}
			app={{} as App}
			onFetchSessions={onFetchSessions}
			onClose={vi.fn()}
		/>,
	);
	return { listSessions, history };
}

const agentPill = (label: string) =>
	screen.getByRole("tab", { name: new RegExp(label) }) as HTMLButtonElement;

describe("I260 — Agent view on a tab that hasn't connected", () => {
	afterEach(cleanup);

	it("a disconnected Claude Code tab opens its Agent view and lists the offline sessions", async () => {
		const { listSessions, history } = openDisconnectedHistory({
			agentId: CLAUDE.id,
			capabilityCache: {
				[agentLaunchKey({ command: CLAUDE.command })]: {
					capabilities: LISTS,
					learnedAt: "2026-11-01T04:55:00Z",
				},
			},
			metaRows: [
				offlineRow("c1", "Plan the Q3 offsite"),
				offlineRow("c2", "Fix the CI pipeline"),
			],
		});

		const pill = agentPill("Claude Code");
		expect(pill.disabled).toBe(false);
		expect(pill.getAttribute("aria-label")).not.toMatch(
			/doesn't keep a session list/,
		);

		await act(async () => {
			fireEvent.click(pill);
		});

		expect(screen.getByText("Plan the Q3 offsite")).toBeTruthy();
		expect(screen.getByText("Fix the CI pipeline")).toBeTruthy();
		expect(screen.getByText(/^Synced /)).toBeTruthy();
		// Connection-free reading: no session/list without a connection, so no
		// "Failed to fetch" error under the offline rows.
		expect(listSessions).not.toHaveBeenCalled();
		expect(history.result.current.error).toBeNull();
	});

	it("an agent known not to list sessions keeps the disabled pill and the 'no server list' tooltip", () => {
		openDisconnectedHistory({
			agentId: KIRO.id,
			kiroEngine: "v2",
			capabilityCache: {
				[agentLaunchKey({ command: KIRO.command, kiroEngine: "v2" })]: {
					capabilities: NO_LIST,
					learnedAt: "2026-11-01T04:55:00Z",
				},
			},
		});
		const pill = agentPill("Kiro CLI");
		expect(pill.disabled).toBe(true);
		expect(pill.getAttribute("aria-label")).toMatch(
			/doesn't keep a session list/,
		);
	});

	it("a V3 launch's capabilities don't carry over to a V2-launched tab", () => {
		openDisconnectedHistory({
			agentId: KIRO.id,
			kiroEngine: "v2",
			capabilityCache: {
				[agentLaunchKey({ command: KIRO.command, kiroEngine: "v3" })]: {
					capabilities: LISTS,
					learnedAt: "2026-11-01T04:55:00Z",
				},
			},
		});
		const pill = agentPill("Kiro CLI");
		expect(pill.disabled).toBe(true);
		// Unknown for this launch: say how to find out, not that it can't list.
		expect(pill.getAttribute("aria-label")).toMatch(/once/);
		expect(pill.getAttribute("aria-label")).not.toMatch(
			/doesn't keep a session list/,
		);
	});

	it("with no capabilities learned yet, the pill is disabled and says to connect once", () => {
		openDisconnectedHistory({ agentId: CLAUDE.id });
		const pill = agentPill("Claude Code");
		expect(pill.disabled).toBe(true);
		expect(pill.getAttribute("aria-label")).toMatch(
			/Send a message in a Claude Code chat once/,
		);
		expect(pill.getAttribute("aria-label")).toContain("Claude Code");
	});
});

describe("I260 — the capability cache is written from initialize", () => {
	function connectedTab(existing: AgentClientPluginSettings["agentCapabilityCache"]) {
		const settings: AgentClientPluginSettings = {
			...DEFAULT_SETTINGS,
			agentCapabilityCache: existing,
		};
		const updateSettings = vi.fn(async () => {});
		const settingsAccess = {
			getSnapshot: () => settings,
			getSavedSessions: () => [],
			subscribe: () => () => {},
			updateSettings,
		} as unknown as ISettingsAccess;
		const key = agentLaunchKey({ command: KIRO.command, kiroEngine: "v3" });
		const agentClient = {
			listSessions: vi.fn(async () => ({ sessions: [] })),
			getLaunchKey: () => key,
		} as unknown as AcpClient;
		const session = {
			sessionId: "s1",
			agentId: KIRO.id,
			state: "ready",
			authMethods: [],
			capabilities: LISTS,
		} as unknown as ChatSession;
		renderHook(() =>
			useSessionHistory({
				agentClient,
				session,
				settingsAccess,
				cwd: VAULT,
				agentCwd: VAULT,
				onSessionLoad: vi.fn(),
			} as Parameters<typeof useSessionHistory>[0]),
		);
		return { updateSettings, key };
	}

	it("saves the reported capabilities under the real launch key", () => {
		const { updateSettings, key } = connectedTab({});
		expect(updateSettings).toHaveBeenCalledTimes(1);
		const written = (
			updateSettings.mock.calls[0] as unknown as [
				Partial<AgentClientPluginSettings>,
			]
		)[0].agentCapabilityCache;
		expect(written?.[key]?.capabilities).toEqual(LISTS);
		expect(typeof written?.[key]?.learnedAt).toBe("string");
	});

	it("doesn't write when the saved capabilities are unchanged", () => {
		const key = agentLaunchKey({ command: KIRO.command, kiroEngine: "v3" });
		const { updateSettings } = connectedTab({
			[key]: { capabilities: LISTS, learnedAt: "2026-10-01T00:00:00Z" },
		});
		expect(updateSettings).not.toHaveBeenCalled();
	});
});
