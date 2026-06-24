/**
 * Deleting a session that is open in a tab should close that tab.
 *
 * Reproduces the smoke-test report (2026-06-23): deleting a session removed it
 * from history + search but left its tab open. Mirrors the I20 restore-switch
 * wiring (findTabBySessionId → act on the tab), but for delete → close.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHistoryModal } from "../useHistoryModal";
import type { App } from "obsidian";
import type { UseAgentReturn } from "../useAgent";
import type { UseSessionHistoryReturn } from "../useSessionHistory";

function makePlugin() {
	return { app: {} as App } as unknown as Parameters<
		typeof useHistoryModal
	>[0];
}

function makeAgent() {
	return { clearMessages: vi.fn() } as unknown as UseAgentReturn;
}

function makeSessionHistory(
	deleteSession: (id: string) => Promise<void>,
): UseSessionHistoryReturn {
	return {
		sessions: [],
		loading: false,
		error: null,
		hasMore: false,
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
		deleteSession: vi.fn(deleteSession),
		updateSessionTitle: vi.fn(async () => {}),
		saveSessionLocally: vi.fn(async () => {}),
		saveSessionMessages: vi.fn(),
		invalidateCache: vi.fn(),
	} as unknown as UseSessionHistoryReturn;
}

function renderDeleteHook(opts: {
	findTabBySessionId: (
		sessionId: string,
	) => { tabId: string; label: string } | null;
	onCloseTab: (tabId: string) => void;
	deleteSession?: (id: string) => Promise<void>;
}) {
	const deleteSession = opts.deleteSession ?? (async () => {});
	return renderHook(() =>
		useHistoryModal(
			makePlugin(),
			makeAgent(),
			makeSessionHistory(deleteSession),
			"/vault",
			true,
			false,
			undefined,
			undefined,
			undefined,
			opts.findTabBySessionId,
			vi.fn(),
			opts.onCloseTab,
		),
	);
}

describe("delete closes open tab", () => {
	it("closes the tab when the deleted session is open in one", async () => {
		const onCloseTab = vi.fn();
		const findTabBySessionId = vi.fn(() => ({
			tabId: "t1",
			label: "test",
		}));
		const deleteSession = vi.fn(async () => {});

		const { result } = renderDeleteHook({
			findTabBySessionId,
			onCloseTab,
			deleteSession,
		});

		await act(async () => {
			await result.current.handleDeleteSession("s1");
		});

		expect(deleteSession).toHaveBeenCalledWith("s1");
		expect(findTabBySessionId).toHaveBeenCalledWith("s1");
		expect(onCloseTab).toHaveBeenCalledWith("t1");
	});

	it("does not close any tab when the session is not open", async () => {
		const onCloseTab = vi.fn();
		const findTabBySessionId = vi.fn(() => null);

		const { result } = renderDeleteHook({
			findTabBySessionId,
			onCloseTab,
		});

		await act(async () => {
			await result.current.handleDeleteSession("s1");
		});

		expect(onCloseTab).not.toHaveBeenCalled();
	});

	it("does not close the tab if deletion fails", async () => {
		const onCloseTab = vi.fn();
		const findTabBySessionId = vi.fn(() => ({
			tabId: "t1",
			label: "test",
		}));
		const deleteSession = vi.fn(async () => {
			throw new Error("delete failed");
		});

		const { result } = renderDeleteHook({
			findTabBySessionId,
			onCloseTab,
			deleteSession,
		});

		await act(async () => {
			await result.current.handleDeleteSession("s1");
		});

		expect(onCloseTab).not.toHaveBeenCalled();
	});
});
