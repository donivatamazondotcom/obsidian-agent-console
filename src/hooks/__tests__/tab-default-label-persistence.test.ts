/**
 * The "still has its default name" flag is saved (Session Title in the Chat
 * Header, Test 8, save half).
 *
 * The chat header hides the grey agent name while a tab still has its default
 * name, so the flag must survive a restart. The save writes it only when true,
 * so saved tabs without it keep their exact shape (U32), and a change to the
 * flag alone triggers a save.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import {
	useTabPersistence,
	type TabPersistenceStorage,
	type UseTabPersistenceProps,
} from "../useTabPersistence";
import type { PerLeafTabState, TabInfo } from "../../types/tab";

function tab(overrides: Partial<TabInfo> = {}): TabInfo {
	return {
		tabId: "T1",
		agentId: "claude-code-acp",
		origin: "fresh",
		label: "Claude Code 08:14 AM",
		state: "ready",
		createdAt: new Date("2026-11-13T10:00:00Z"),
		...overrides,
	};
}

type Storage = TabPersistenceStorage & { saveTabStateForLeaf: ReturnType<typeof vi.fn> };

function storage(): Storage {
	return {
		saveTabStateForLeaf: vi.fn().mockResolvedValue(undefined),
		loadTabStateForLeaf: vi.fn().mockResolvedValue(null),
		loadSessionMessages: vi.fn().mockResolvedValue(null),
		loadSessionContextNotes: vi.fn().mockResolvedValue(null),
	} as Storage;
}

function props(tabs: TabInfo[], s: Storage): UseTabPersistenceProps {
	return {
		leafId: "leaf-1",
		tabs,
		activeTabId: "T1",
		getSessionId: () => null,
		getScrollPosition: () => 0,
		getDraft: () => "",
		getWorkingDirectory: () => "",
		storage: s,
		restoreEnabled: true,
	};
}

const lastSaved = (s: Storage) =>
	(s.saveTabStateForLeaf.mock.calls.at(-1) as [string, PerLeafTabState])[1].tabs[0];

describe("labelIsDefault persistence", () => {
	it("a default-named tab is saved with labelIsDefault: true", async () => {
		const s = storage();
		renderHook(() => useTabPersistence(props([tab({ labelIsDefault: true })], s)));
		await waitFor(() => expect(s.saveTabStateForLeaf).toHaveBeenCalled());
		expect(lastSaved(s).labelIsDefault).toBe(true);
	});

	it("a renamed tab is saved without the key", async () => {
		const s = storage();
		renderHook(() =>
			useTabPersistence(props([tab({ label: "Debug CI", labelIsDefault: false })], s)),
		);
		await waitFor(() => expect(s.saveTabStateForLeaf).toHaveBeenCalled());
		expect("labelIsDefault" in lastSaved(s)).toBe(false);
	});

	it("a change to labelIsDefault alone triggers a save", async () => {
		const s = storage();
		const { rerender } = renderHook(
			({ tabs }: { tabs: TabInfo[] }) => useTabPersistence(props(tabs, s)),
			{ initialProps: { tabs: [tab({ labelIsDefault: true })] } },
		);
		await waitFor(() => expect(s.saveTabStateForLeaf).toHaveBeenCalled());
		s.saveTabStateForLeaf.mockClear();
		rerender({ tabs: [tab({ labelIsDefault: false })] });
		await waitFor(() => expect(s.saveTabStateForLeaf).toHaveBeenCalledTimes(1));
		expect("labelIsDefault" in lastSaved(s)).toBe(false);
	});

	it("a change to labelIsCustom alone triggers a save", async () => {
		const s = storage();
		const { rerender } = renderHook(
			({ tabs }: { tabs: TabInfo[] }) => useTabPersistence(props(tabs, s)),
			{ initialProps: { tabs: [tab({ label: "Same", labelIsCustom: false })] } },
		);
		await waitFor(() => expect(s.saveTabStateForLeaf).toHaveBeenCalled());
		s.saveTabStateForLeaf.mockClear();
		rerender({ tabs: [tab({ label: "Same", labelIsCustom: true })] });
		await waitFor(() => expect(s.saveTabStateForLeaf).toHaveBeenCalledTimes(1));
		expect(lastSaved(s).labelIsCustom).toBe(true);
	});
});
