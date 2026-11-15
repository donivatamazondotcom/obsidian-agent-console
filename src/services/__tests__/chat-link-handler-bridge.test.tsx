/**
 * Chat ID — the chat-link handler driving a real panel bridge
 * ([[Agent Console Chat ID]] D12, D15).
 *
 * - T13: a link to a chat in history opens one restored tab carrying the
 *   record's ID.
 * - T42 (same id): the same link fired twice, 3 s apart, while layout-ready
 *   is pending, ends with exactly one tab holding the chat. The second run
 *   must wait for the first run's tab to report (the settle wait), because
 *   `addTab` only queues a React update.
 *
 * Seams (R2): the real `createChatLinkHandler`, the real `useOpenChatBridge`
 * over a real `useTabManager`, the real `applyRecordIdReport` /
 * `resolveRecordIdForSave`. Each tab reports its mount binding in an effect,
 * as `useSessionHistory` does for a ChatPanel. React renders on its own
 * schedule between the handler's awaits (no enclosing `act`). Fakes only at
 * the boundaries (R4): the Workspace, the leaf and its window, and ChatView's
 * `openRecordInTab` reduced to its tab effects (no harness, D12).
 *
 * Assertions (R3): the panel's tabs, the active tab and the bound chat IDs.
 * Literals (R5).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { useCallback, useEffect, useRef } from "react";

import { createChatLinkHandler } from "../chat-link-handler";
import { useOpenChatBridge } from "../../hooks/useOpenChatBridge";
import { useTabManager } from "../../hooks/useTabManager";
import {
	applyRecordIdReport,
	resolveRecordIdForSave,
} from "../session-helpers";
import type {
	ChatLinkLeaf,
	ChatLinkRateLimitState,
	OpenChatBridge,
	OpenRecordResult,
} from "../../types/chat-link";
import type { SavedSessionInfo } from "../../types/session";
import type { TabInfo } from "../../types/tab";

const VIEW = "agent-client-chat-view";

const RECORD: SavedSessionInfo = {
	recordId: "rec-x",
	sessionId: "sess-x",
	agentId: "kiro",
	cwd: "/vault",
	title: "Chat X",
	createdAt: "2026-11-02T09:00:00.000Z",
	updatedAt: "2026-11-02T09:05:00.000Z",
};

const act_env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let prevActEnv: boolean | undefined;
beforeAll(() => {
	// React renders on its own schedule between the handler's awaits.
	prevActEnv = act_env.IS_REACT_ACT_ENVIRONMENT;
	act_env.IS_REACT_ACT_ENVIRONMENT = false;
});
afterAll(() => {
	act_env.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
	cleanup();
});

interface PanelProbe {
	bridge: OpenChatBridge | null;
	tabs: TabInfo[];
	activeTabId: string;
	opens: number;
	persistedRecordIds: Map<string, string>;
}

/** A tab's mount report, as `useSessionHistory` makes one for a ChatPanel. */
function TabReporter(props: {
	tabId: string;
	restoredRecordId: string | null;
	report: (tabId: string, id: string | null) => void;
}) {
	const { tabId, restoredRecordId, report } = props;
	// Reported once, at mount, like useSessionHistory's mount report.
	const atMount = useRef(restoredRecordId);
	useEffect(() => {
		report(tabId, atMount.current);
	}, [tabId, report]);
	return null;
}

/** ChatView's panel, reduced to the tab manager, the id maps and the bridge. */
function Panel({ probe }: { probe: PanelProbe }) {
	const tm = useTabManager("kiro", [
		{
			tabId: "t0",
			agentId: "kiro",
			origin: "restored",
			label: "Other",
			state: "disconnected",
			createdAt: new Date(0),
		},
	]);
	const tabRecordIdsRef = useRef(new Map<string, string | null>());
	const persistedRecordIdsRef = useRef(new Map<string, string>());
	const persistedSessionIdsRef = useRef(
		new Map<string, string | null>([["t0", "sess-other"]]),
	);
	const getRecordIdForTab = useCallback(
		(tabId: string) =>
			resolveRecordIdForSave(
				{
					has: tabRecordIdsRef.current.has(tabId),
					id: tabRecordIdsRef.current.get(tabId) ?? null,
				},
				persistedRecordIdsRef.current.get(tabId) ?? null,
			),
		[],
	);
	const report = useCallback((tabId: string, id: string | null) => {
		applyRecordIdReport(
			tabRecordIdsRef.current,
			persistedRecordIdsRef.current,
			tabId,
			id,
		);
	}, []);
	const openRecordInTab = async (
		sessionId: string,
		_mode: "restore",
		opts: { recordId: string },
	): Promise<OpenRecordResult> => {
		probe.opens++;
		const id = tm.addTab("kiro", "Chat X", true, "restored");
		persistedSessionIdsRef.current.set(id, sessionId);
		persistedRecordIdsRef.current.set(id, opts.recordId);
		return "opened";
	};
	const bridge = useOpenChatBridge({
		tabs: tm.tabs,
		tabRecordIdsRef,
		persistedRecordIdsRef,
		persistedSessionIdsRef,
		getRecordIdForTab,
		setActiveTab: tm.setActiveTab,
		getSavedSessions: () => [RECORD],
		openRecordInTab,
	});
	useEffect(() => {
		probe.bridge = bridge;
		return () => {
			probe.bridge = null;
		};
	}, [bridge, probe]);
	probe.tabs = tm.tabs;
	probe.activeTabId = tm.activeTabId;
	probe.persistedRecordIds = persistedRecordIdsRef.current;
	return (
		<>
			{tm.tabs.map((t) => (
				<TabReporter
					key={t.tabId}
					tabId={t.tabId}
					restoredRecordId={persistedRecordIdsRef.current.get(t.tabId) ?? null}
					report={report}
				/>
			))}
		</>
	);
}

function setup(opts: { layoutReady: boolean }) {
	const probe: PanelProbe = {
		bridge: null,
		tabs: [],
		activeTabId: "",
		opens: 0,
		persistedRecordIds: new Map(),
	};
	act(() => {
		render(<Panel probe={probe} />);
	});
	const win = {
		requestAnimationFrame: (cb: (t: number) => void) =>
			setTimeout(() => cb(0), 0) as unknown as number,
	};
	const leaf: ChatLinkLeaf = {
		id: "leaf-1",
		view: { containerEl: { win } as unknown as HTMLElement },
	};
	let ready = opts.layoutReady;
	const readyCallbacks: Array<() => void> = [];
	let rate: ChatLinkRateLimitState = {};
	let now = 0;
	const notices: string[] = [];
	const handler = createChatLinkHandler<ChatLinkLeaf>({
		workspace: {
			getLeavesOfType: (type) => (type === VIEW ? [leaf] : []),
			onLayoutReady: (cb) => {
				if (ready) cb();
				else readyCallbacks.push(cb);
			},
			revealLeaf: async () => {},
			setActiveLeaf: () => {},
		},
		viewType: VIEW,
		getBridge: () => probe.bridge,
		restoreTabsOnStartup: () => true,
		perLeafTabStates: () => [],
		savedSessions: () => [RECORD],
		lastActiveChatViewId: () => "leaf-1",
		getTargetChatLeaf: () => leaf,
		activateView: async () => {},
		waitForChatViewOpener: async () => ({ leaf }),
		rateLimit: {
			get: () => rate,
			set: (s) => {
				rate = s;
			},
		},
		now: () => now,
		notify: (m) => notices.push(m),
		logError: () => {},
	});
	return {
		probe,
		notices,
		fire(at: number) {
			now = at;
			return handler({ id: "rec-x" });
		},
		setLayoutReady() {
			ready = true;
			for (const cb of readyCallbacks.splice(0)) cb();
		},
	};
}

/** Let React's scheduled render and passive effects run. */
async function settleReact() {
	for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

describe("chat link handler over a real panel bridge", () => {
	it("T13: a link to a chat in history opens one restored tab carrying its ID", async () => {
		const env = setup({ layoutReady: true });
		await env.fire(0);
		await settleReact();
		const { probe } = env;
		expect(probe.opens).toBe(1);
		expect(probe.tabs).toHaveLength(2);
		const opened = probe.tabs[1];
		expect(opened.origin).toBe("restored");
		expect(probe.activeTabId).toBe(opened.tabId);
		expect(probe.bridge!.boundChatIds()).toEqual([
			{ tabId: opened.tabId, chatId: "rec-x" },
		]);
		expect(env.notices).toEqual([]);
		cleanup();
	});

	it("T42 (same id): two fires 3 s apart while layout-ready is pending end with one tab holding the chat", async () => {
		const env = setup({ layoutReady: false });
		const first = env.fire(0);
		const second = env.fire(3000);
		env.setLayoutReady();
		await Promise.all([first, second]);
		await settleReact();
		const { probe } = env;
		expect(probe.opens).toBe(1);
		expect(probe.tabs).toHaveLength(2);
		const holding = probe.bridge!
			.boundChatIds()
			.filter((b) => b.chatId === "rec-x");
		expect(holding).toHaveLength(1);
		expect(probe.activeTabId).toBe(holding[0].tabId);
		expect(env.notices).toEqual([]);
		cleanup();
	});
});
