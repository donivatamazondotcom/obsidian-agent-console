/**
 * RC-4 — the Session History modal must not be left orphaned (showing stale
 * content) when its owning host unmounts.
 *
 * Smoke report (2026-06-27, Kiro CLI, single session): deleting a session that
 * was open in the only tab closed that tab — which unmounts the ChatPanel that
 * OWNS the open history modal. The modal kept rendering its last state (the
 * just-deleted row) because the `useHistoryModal` effect that drives
 * `updateProps` had unmounted with it. The file WAS deleted (reopening in a
 * fresh tab showed an empty list), so it was a modal-lifecycle leak, not a
 * deletion failure.
 *
 * Fix: `useHistoryModal` closes the modal on unmount. This test pins it.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHistoryModal } from "../useHistoryModal";
import { SessionHistoryModal } from "../../ui/SessionHistoryModal";
import type { App } from "obsidian";
import type { UseAgentReturn } from "../useAgent";
import type { UseSessionHistoryReturn } from "../useSessionHistory";

function makePlugin() {
	return {
		app: {} as App,
		settingsService: {
			getSnapshot: () => ({
				sessionHistorySource: "local",
				agentSessionMetaCache: {},
			}),
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

function makeSessionHistory(): UseSessionHistoryReturn {
	return {
		sessions: [],
		loading: false,
		error: null,
		hasMore: false,
		capabilities: {
			listsSessions: false,
			restoresViaLoad: false,
			restoresViaResume: true,
			forks: false,
			reportsModels: false,
		},
		canShowSessionHistory: true,
		canRestore: true,
		canFork: false,
		canList: false,
		isUsingLocalSessions: true,
		localSessionIds: new Set<string>(),
		fetchSessions: vi.fn(async () => {}),
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
}

describe("history modal lifecycle (RC-4)", () => {
	it("closes the open modal when the owning host unmounts", () => {
		const closeSpy = vi.spyOn(SessionHistoryModal.prototype, "close");
		const { result, unmount } = renderHook(() =>
			useHistoryModal(
				makePlugin(),
				makeAgent(),
				makeSessionHistory(),
				"/vault",
				true,
				false,
			),
		);

		act(() => {
			result.current.handleOpenHistory();
		});
		// Opened, not yet closed.
		expect(closeSpy).not.toHaveBeenCalled();

		// Owning ChatPanel torn down (e.g. delete-closes-open-tab).
		unmount();

		// The modal must have been closed — no orphaned stale modal.
		expect(closeSpy).toHaveBeenCalled();
		closeSpy.mockRestore();
	});

	it("does nothing on unmount when no modal was ever opened", () => {
		const closeSpy = vi.spyOn(SessionHistoryModal.prototype, "close");
		const { unmount } = renderHook(() =>
			useHistoryModal(
				makePlugin(),
				makeAgent(),
				makeSessionHistory(),
				"/vault",
				true,
				false,
			),
		);
		unmount();
		expect(closeSpy).not.toHaveBeenCalled();
		closeSpy.mockRestore();
	});
});
