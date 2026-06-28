/**
 * Reproducing test for I128: renaming a session in the history modal
 * does NOT update the open tab's label when the tab carries
 * labelIsCustom = true.
 *
 * Root cause: handleEditTitle → onLabelChange flows through a path
 * that calls setTabLabel(tabId, label) WITHOUT custom=true. The guard
 * in setTabLabel rejects non-custom overwrites of a custom label.
 *
 * This test exercises the integration: useTabManager + the rename chain.
 * A tab with a custom label must accept a history-rename (which is
 * itself a custom user action, arriving via setTabLabel with custom=true).
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabManager } from "../useTabManager";

describe("I128 — history rename must update an open tab with a custom label", () => {
	it("setTabLabel with custom=true overwrites an existing custom label", () => {
		const { result } = renderHook(() => useTabManager("test-agent"));
		const tabId = result.current.activeTab.tabId;

		// Step 1: Tab gets a custom label (e.g. from a prior rename)
		act(() => result.current.setTabLabel(tabId, "Write debugging haiku", true));
		expect(result.current.activeTab.label).toBe("Write debugging haiku");
		expect(result.current.activeTab.labelIsCustom).toBe(true);

		// Step 2: A history-modal rename arrives with custom=true.
		// This is the FIX path — it MUST succeed.
		act(() => result.current.setTabLabel(tabId, "Write debugging haikus", true));
		expect(result.current.activeTab.label).toBe("Write debugging haikus");
	});

	it("setTabLabel WITHOUT custom=true is rejected on a custom-labeled tab (the bug)", () => {
		const { result } = renderHook(() => useTabManager("test-agent"));
		const tabId = result.current.activeTab.tabId;

		// Tab has a custom label
		act(() => result.current.setTabLabel(tabId, "Write debugging haiku", true));
		expect(result.current.activeTab.label).toBe("Write debugging haiku");

		// History modal rename arrives WITHOUT custom — this is what
		// the unfixed code does. It gets rejected by the guard.
		act(() => result.current.setTabLabel(tabId, "Write debugging haikus"));
		// BUG: the label is unchanged — the rename was dropped.
		expect(result.current.activeTab.label).toBe("Write debugging haiku");
	});

	it("the full chain: handleEditTitle must call setTabLabel with custom=true via findTabBySessionId", async () => {
		// This test verifies the fix at the useHistoryModal level by checking
		// that the new onSetTabLabelCustom callback is called.
		const { useHistoryModal } = await import("../useHistoryModal");
		const { SessionHistoryModal } = await import(
			"../../ui/SessionHistoryModal"
		);
		const { App } = await import("obsidian");

		const setTabLabelCustom = vi.fn();
		const findTabBySessionId = vi.fn((sessionId: string) =>
			sessionId === "session-123"
				? { tabId: "tab-1", label: "Old Title" }
				: null,
		);
		const updateSessionTitle = vi.fn(async () => {});

		const plugin = {
			app: {} as InstanceType<typeof App>,
			settingsService: {
				getSnapshot: () => ({
					sessionHistorySource: "local",
					agentSessionMetaCache: {},
				}),
			},
			getAvailableAgents: () => [],
		} as unknown as Parameters<typeof useHistoryModal>[0];

		const agent = {
			clearMessages: vi.fn(),
			session: { agentId: "test-agent" },
		} as unknown as Parameters<typeof useHistoryModal>[1];

		const sessionHistory = {
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
			updateSessionTitle,
			saveSessionLocally: vi.fn(async () => {}),
			saveSessionMessages: vi.fn(),
			applySessionTitle: vi.fn(),
			loadSessionMessages: vi.fn(async () => null),
			invalidateCache: vi.fn(),
		} as unknown as Parameters<typeof useHistoryModal>[2];

		const { result } = renderHook(() =>
			useHistoryModal(
				plugin,
				agent,
				sessionHistory,
				"/vault",
				true,
				false,
				undefined, // onAgentCwdChange
				undefined, // onLabelChange
				"session-123", // currentSessionId
				findTabBySessionId,
				undefined, // onSwitchToTab
				undefined, // onCloseTab
				undefined, // onOpenSessionInTab
				setTabLabelCustom, // new param: applies custom label to a tab
			),
		);

		// Expose handleEditTitle by opening the modal and invoking onEditTitle
		// — but the modal is an Obsidian modal we can't easily drive in jsdom.
		// Instead, verify the hook returns handleEditTitle (after the fix
		// exposes it for this exact purpose).
		await act(async () => {
			await result.current.handleEditTitle(
				"session-123",
				"New Title",
				"/vault",
			);
		});

		expect(updateSessionTitle).toHaveBeenCalledWith(
			"session-123",
			"New Title",
			"/vault",
		);
		expect(setTabLabelCustom).toHaveBeenCalledWith("tab-1", "New Title");
	});
});
