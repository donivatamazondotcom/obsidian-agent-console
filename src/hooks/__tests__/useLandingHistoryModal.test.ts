/**
 * useLandingHistoryModal (Slice 4 of [[Agent Console Close Last Tab to Empty
 * State]]) — the zero-tab landing opens the shipped session-history modal at
 * the view level (no ChatPanel host, no live agent → Local source only), and a
 * selected session is restored/forked via ChatView's openSessionInTab (which
 * spawns a tab). This pins the wiring: open builds Local props; restore/fork
 * route to the orchestration callback; delete refreshes the list.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
	lastProps: null as unknown as Record<string, unknown>,
	openSpy: vi.fn(),
	closeSpy: vi.fn(),
	updateSpy: vi.fn(),
}));

vi.mock("../../ui/SessionHistoryModal", () => ({
	SessionHistoryModal: vi
		.fn()
		.mockImplementation((_app: unknown, props: Record<string, unknown>) => {
			h.lastProps = props;
			return {
				open: h.openSpy,
				close: h.closeSpy,
				updateProps: (p: Record<string, unknown>) => {
					h.lastProps = p;
					h.updateSpy(p);
				},
			};
		}),
}));

import { SessionHistoryModal } from "../../ui/SessionHistoryModal";
import { useLandingHistoryModal } from "../useLandingHistoryModal";
import type AgentClientPlugin from "../../plugin";

function makePlugin(deleteSession = vi.fn().mockResolvedValue(undefined)) {
	return {
		app: { vault: { adapter: {} } },
		settingsService: {
			getSavedSessions: vi.fn(() => [
				{
					sessionId: "s1",
					cwd: "/vault",
					title: "First session",
					updatedAt: 5,
					agentId: "kiro-cli",
				},
			]),
			getSnapshot: () => ({ debugMode: false }),
			loadSessionMessages: vi.fn(),
			deleteSession,
			sessionStore: {
				renameSession: vi.fn().mockResolvedValue(undefined),
			},
		},
		getAvailableAgents: () => [
			{ id: "kiro-cli", displayName: "Kiro CLI" },
		],
		settings: { defaultAgentId: "kiro-cli" },
	} as unknown as AgentClientPlugin;
}

beforeEach(() => {
	vi.clearAllMocks();
	h.lastProps = null as unknown as Record<string, unknown>;
});

describe("useLandingHistoryModal — view-level Local history opener", () => {
	it("opens the modal on the Local source with the on-disk sessions", () => {
		const plugin = makePlugin();
		const onOpenSessionInTab = vi.fn();
		const { result } = renderHook(() =>
			useLandingHistoryModal(plugin, onOpenSessionInTab),
		);

		act(() => result.current.openLandingHistory());

		expect(SessionHistoryModal).toHaveBeenCalledTimes(1);
		expect(h.openSpy).toHaveBeenCalledTimes(1);
		expect(h.lastProps.initialSource).toBe("local");
		expect(h.lastProps.isAgentReady).toBe(false);
		const sessions = h.lastProps.sessions as Array<{ sessionId: string }>;
		expect(sessions).toHaveLength(1);
		expect(sessions[0].sessionId).toBe("s1");
	});

	it("restore routes through openSessionInTab in restore mode (spawns a tab)", async () => {
		const plugin = makePlugin();
		const onOpenSessionInTab = vi.fn();
		const { result } = renderHook(() =>
			useLandingHistoryModal(plugin, onOpenSessionInTab),
		);
		act(() => result.current.openLandingHistory());

		await act(async () => {
			await (
				h.lastProps.onRestoreSession as (
					id: string,
					cwd: string,
				) => Promise<void>
			)("s1", "/vault");
		});
		expect(onOpenSessionInTab).toHaveBeenCalledWith(
			"s1",
			"/vault",
			"restore",
		);
	});

	it("fork routes through openSessionInTab in fork mode", async () => {
		const plugin = makePlugin();
		const onOpenSessionInTab = vi.fn();
		const { result } = renderHook(() =>
			useLandingHistoryModal(plugin, onOpenSessionInTab),
		);
		act(() => result.current.openLandingHistory());

		await act(async () => {
			await (
				h.lastProps.onForkSession as (
					id: string,
					cwd: string,
				) => Promise<void>
			)("s1", "/vault");
		});
		expect(onOpenSessionInTab).toHaveBeenCalledWith("s1", "/vault", "fork");
	});

	it("delete removes the session from the store and refreshes the list", async () => {
		const deleteSession = vi.fn().mockResolvedValue(undefined);
		const plugin = makePlugin(deleteSession);
		const { result } = renderHook(() =>
			useLandingHistoryModal(plugin, vi.fn()),
		);
		act(() => result.current.openLandingHistory());

		await act(async () => {
			await (
				h.lastProps.onDeleteSession as (id: string) => Promise<void>
			)("s1");
		});
		expect(deleteSession).toHaveBeenCalledWith("s1");
		expect(h.updateSpy).toHaveBeenCalled(); // refresh re-sourced props
	});
});
