/**
 * I270 — Session history lists V3 server sessions while the Kiro agent runs V2.
 *
 * Smoke report (2026-11-02, I265 smoke): with the Kiro engine on V2, the
 * Agent view listed Kiro V3 server sessions. Probe (2026-11-06): the "V2"
 * launch ran V3 because it passed no engine flag, and the server-session
 * cache it filled was keyed by agent id, so any later tab of that agent
 * served V3 rows whatever it launched. The cache is now keyed by launch and
 * read through `historyLaunchKey`.
 *
 * Seams (R2): the real `useSessionHistory` (writer and capability gate)
 * feeds the real `useHistoryModal`, whose props render the real
 * `SessionHistoryContent`. Only the ports are faked: the agent client and a
 * settings store that keeps what is written (R4).
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
	SessionState,
} from "../../types/session";
import type { UseAgentReturn } from "../useAgent";
import { DEFAULT_SETTINGS } from "../../services/settings-normalizer";
import { agentLaunchKey } from "../../utils/agent-launch-key";

const VAULT = "/vault";
const KIRO = DEFAULT_SETTINGS.kiro;
const V3_KEY = agentLaunchKey({ command: KIRO.command, kiroEngine: "v3" });
const V2_KEY = agentLaunchKey({ command: KIRO.command, kiroEngine: "v2" });

const LISTS: AgentCapabilities = {
	listsSessions: true,
	restoresViaLoad: true,
	restoresViaResume: false,
	forks: true,
	closesSessions: true,
	deletesSessions: false,
	reportsModels: true,
};
const NO_LIST: AgentCapabilities = {
	listsSessions: false,
	restoresViaLoad: true,
	restoresViaResume: false,
	forks: false,
	closesSessions: false,
	deletesSessions: false,
	reportsModels: true,
};

const V3_ROWS: SessionInfo[] = [
	{ sessionId: "sess_a", cwd: VAULT, title: "V3 chat about the offsite", updatedAt: "2026-11-05T10:00:00Z" },
	{ sessionId: "sess_b", cwd: VAULT, title: "V3 chat about CI", updatedAt: "2026-11-05T09:00:00Z" },
];

/** A settings port that keeps what's written, like the real service. */
function makeStore(initial: Partial<AgentClientPluginSettings>) {
	let settings = { ...DEFAULT_SETTINGS, sessionHistorySource: "local", ...initial } as AgentClientPluginSettings;
	const updateSettings = vi.fn(async (patch: Partial<AgentClientPluginSettings>) => {
		settings = { ...settings, ...patch };
	});
	const access = {
		getSnapshot: () => settings,
		getSavedSessions: () => [],
		subscribe: () => () => {},
		updateSettings,
	} as unknown as ISettingsAccess;
	return {
		access,
		updateSettings,
		get settings() {
			return settings;
		},
		setEngine(engine: "v2" | "v3") {
			settings = { ...settings, kiro: { ...settings.kiro, engine } };
		},
	};
}

interface Tab {
	state: SessionState;
	capabilities?: AgentCapabilities;
	launchKey: string | null;
	listSessions?: () => Promise<{ sessions: SessionInfo[] }>;
}

function mountTab(store: ReturnType<typeof makeStore>, tab: Tab) {
	const listSessions = vi.fn(tab.listSessions ?? (async () => ({ sessions: V3_ROWS })));
	let launchKey = tab.launchKey;
	const agentClient = {
		listSessions,
		getLaunchKey: () => launchKey,
	} as unknown as AcpClient;
	const session = {
		sessionId: tab.state === "ready" ? "s-live" : null,
		agentId: KIRO.id,
		state: tab.state,
		authMethods: [],
		...(tab.capabilities ? { capabilities: tab.capabilities } : {}),
	} as unknown as ChatSession;
	const history = renderHook(() =>
		useSessionHistory({
			agentClient,
			session,
			settingsAccess: store.access,
			cwd: VAULT,
			agentCwd: VAULT,
			onSessionLoad: vi.fn(),
		} as Parameters<typeof useSessionHistory>[0]),
	);
	return {
		history,
		listSessions,
		session,
		setLaunchKey(k: string | null) {
			launchKey = k;
		},
	};
}

/** Open Session history for a mounted tab and render the modal content. */
function openHistory(
	store: ReturnType<typeof makeStore>,
	tab: ReturnType<typeof mountTab>,
) {
	let props: SessionHistoryModalProps | undefined;
	let modalInstance: SessionHistoryModal | undefined;
	const openSpy = vi
		.spyOn(SessionHistoryModal.prototype, "open")
		.mockImplementation(function (this: SessionHistoryModal) {
			modalInstance = this;
			props = (this as unknown as { props: SessionHistoryModalProps }).props;
		});
	const updateSpy = vi
		.spyOn(SessionHistoryModal.prototype, "updateProps")
		.mockImplementation(function (this: SessionHistoryModal, next: Partial<SessionHistoryModalProps>) {
			props = { ...(props as SessionHistoryModalProps), ...next };
		});
	const plugin = {
		app: {} as App,
		settingsService: {
			getSnapshot: () => store.settings,
			getSavedSessions: () => [],
			updateSettings: store.updateSettings,
		},
		getAvailableAgents: () => [{ id: KIRO.id, displayName: KIRO.displayName }],
	} as unknown as Parameters<typeof useHistoryModal>[0];
	const agent = { clearMessages: vi.fn(), session: tab.session } as unknown as UseAgentReturn;
	const modal = renderHook(
		({ h }) => useHistoryModal(plugin, agent, h, VAULT, tab.session.state === "ready", false),
		{ initialProps: { h: tab.history.result.current } },
	);
	act(() => {
		modal.result.current.handleOpenHistory();
	});
	openSpy.mockRestore();
	if (!props || !modalInstance) throw new Error("history modal did not open");

	const renderContent = () =>
		render(
			<SessionHistoryContent
				{...(props as SessionHistoryModalProps)}
				app={{} as App}
				onFetchSessions={(source, cwd) => {
					void tab.history.result.current.fetchSessions(source, cwd);
				}}
				onClose={vi.fn()}
			/>,
		);
	return {
		renderContent,
		getProps: () => props as SessionHistoryModalProps,
		rerenderModal: () => modal.rerender({ h: tab.history.result.current }),
		cleanupSpies: () => updateSpy.mockRestore(),
	};
}

const agentPill = () =>
	screen.getByRole("tab", { name: /Kiro CLI/ }) as HTMLButtonElement;

/** A V3 tab connects and mirrors its server list, through the real writer. */
async function syncV3(store: ReturnType<typeof makeStore>) {
	const v3 = mountTab(store, { state: "ready", capabilities: LISTS, launchKey: V3_KEY });
	await act(async () => {
		await v3.history.result.current.syncServerSessionCache();
	});
	v3.history.unmount();
}

describe("I270 — a V2 tab's Agent view omits V3-only sessions", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("disconnected V2 tab, after a V3 tab synced its list: no V3 rows", async () => {
		// The I260 capability entry the mislabeled V2 launch learned.
		const store = makeStore({
			kiro: { ...KIRO, engine: "v2" },
			agentCapabilityCache: {
				[V2_KEY]: { capabilities: LISTS, learnedAt: "2026-11-02T00:00:00Z" },
			},
		});
		await syncV3(store);

		const v2 = mountTab(store, { state: "disconnected", launchKey: null });
		const h = openHistory(store, v2);
		h.renderContent();
		const pill = agentPill();
		if (!pill.disabled) {
			await act(async () => {
				fireEvent.click(pill);
			});
		}
		expect(screen.queryByText("V3 chat about the offsite")).toBeNull();
		expect(screen.queryByText("V3 chat about CI")).toBeNull();
		expect(v2.listSessions).not.toHaveBeenCalled();
	});

	it("connected V2 tab: pill unsupported, no session/list, no cache write", async () => {
		const store = makeStore({ kiro: { ...KIRO, engine: "v2" } });
		await syncV3(store);
		store.updateSettings.mockClear();

		const v2 = mountTab(store, { state: "ready", capabilities: NO_LIST, launchKey: V2_KEY });
		await act(async () => {
			await v2.history.result.current.syncServerSessionCache();
		});
		const h = openHistory(store, v2);
		h.renderContent();
		const pill = agentPill();
		expect(pill.disabled).toBe(true);
		expect(pill.getAttribute("aria-label")).toMatch(/doesn't keep a session list/);
		expect(screen.queryByText("V3 chat about the offsite")).toBeNull();
		expect(v2.listSessions).not.toHaveBeenCalled();
		const wrote = store.updateSettings.mock.calls.some(
			([patch]) => "serverSessionCache" in (patch as object),
		);
		expect(wrote).toBe(false);
	});
});

describe("I270 — a V3 tab still lists its own sessions", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("disconnected V3 tab serves the V3 list from the cache", async () => {
		const store = makeStore({
			kiro: { ...KIRO, engine: "v3" },
			agentCapabilityCache: {
				[V3_KEY]: { capabilities: LISTS, learnedAt: "2026-11-02T00:00:00Z" },
			},
		});
		await syncV3(store);
		expect(Object.keys(store.settings.serverSessionCache)).toEqual([V3_KEY]);

		const v3 = mountTab(store, { state: "disconnected", launchKey: null });
		openHistory(store, v3).renderContent();
		await act(async () => {
			fireEvent.click(agentPill());
		});
		expect(screen.getByText("V3 chat about the offsite")).toBeTruthy();
		expect(v3.listSessions).not.toHaveBeenCalled();
	});

	it("connected V3 tab lists live", async () => {
		const store = makeStore({ kiro: { ...KIRO, engine: "v3" } });
		const v3 = mountTab(store, { state: "ready", capabilities: LISTS, launchKey: V3_KEY });
		openHistory(store, v3).renderContent();
		await act(async () => {
			fireEvent.click(agentPill());
		});
		expect(v3.listSessions).toHaveBeenCalled();
		// The live list lands in the hook state the modal is fed from.
		await vi.waitFor(() =>
			expect(v3.history.result.current.sessions.map((s) => s.title)).toContain(
				"V3 chat about the offsite",
			),
		);
	});
});

describe("I270 — a released tab reads one launch after an engine switch", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("released V3 tab, engine now V2: the pill follows the V2 launch, no V3 rows", async () => {
		const store = makeStore({
			kiro: { ...KIRO, engine: "v3" },
			agentCapabilityCache: {
				[V2_KEY]: { capabilities: NO_LIST, learnedAt: "2026-11-02T00:00:00Z" },
			},
		});
		await syncV3(store);
		store.setEngine("v2");
		// Idle release keeps the old process's capabilities; the process is gone.
		const tab = mountTab(store, { state: "disconnected", capabilities: LISTS, launchKey: null });
		openHistory(store, tab).renderContent();
		const pill = agentPill();
		expect(pill.disabled).toBe(true);
		expect(screen.queryByText("V3 chat about the offsite")).toBeNull();
	});

	it("released V2 tab, engine now V3: the pill follows the V3 launch and lists its rows", async () => {
		const store = makeStore({
			kiro: { ...KIRO, engine: "v2" },
			agentCapabilityCache: {
				[V3_KEY]: { capabilities: LISTS, learnedAt: "2026-11-02T00:00:00Z" },
			},
		});
		await syncV3(store);
		store.setEngine("v3");
		const tab = mountTab(store, { state: "disconnected", capabilities: NO_LIST, launchKey: null });
		openHistory(store, tab).renderContent();
		const pill = agentPill();
		expect(pill.disabled).toBe(false);
		await act(async () => {
			fireEvent.click(pill);
		});
		expect(screen.getByText("V3 chat about the offsite")).toBeTruthy();
	});
});

describe("I270 — the server-session writer", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("writes under the live launch key, never the agent id", async () => {
		const store = makeStore({});
		await syncV3(store);
		expect(store.settings.serverSessionCache[V3_KEY]?.sessions).toEqual(V3_ROWS);
		expect(store.settings.serverSessionCache[KIRO.id]).toBeUndefined();
	});

	it("a relaunch while the list is in flight writes nothing", async () => {
		const store = makeStore({});
		let resolveList: (v: { sessions: SessionInfo[] }) => void = () => {};
		const tab = mountTab(store, {
			state: "ready",
			capabilities: LISTS,
			launchKey: V3_KEY,
			listSessions: () => new Promise((r) => (resolveList = r)),
		});
		let pending: Promise<void> = Promise.resolve();
		act(() => {
			pending = tab.history.result.current.syncServerSessionCache();
		});
		tab.setLaunchKey(V2_KEY);
		await act(async () => {
			resolveList({ sessions: V3_ROWS });
			await pending;
		});
		expect(store.settings.serverSessionCache).toEqual({});
	});
});

describe("I270 — the open modal follows the launch key", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("an engine switch while the modal is open drops the other launch's rows", async () => {
		const store = makeStore({
			kiro: { ...KIRO, engine: "v3" },
			agentCapabilityCache: {
				[V3_KEY]: { capabilities: LISTS, learnedAt: "2026-11-02T00:00:00Z" },
			},
		});
		await syncV3(store);
		const tab = mountTab(store, { state: "disconnected", launchKey: null });
		const h = openHistory(store, tab);
		expect(h.getProps().agentSessionCache?.sessions).toHaveLength(2);

		store.setEngine("v2");
		tab.history.rerender();
		h.rerenderModal();
		expect(h.getProps().agentSessionCache).toBeNull();
		h.cleanupSpies();
	});
});
