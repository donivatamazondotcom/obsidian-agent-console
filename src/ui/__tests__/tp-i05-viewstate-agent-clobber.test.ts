/**
 * TP-I05 — Restored tab reverts to the default agent (view-state agentId
 * clobbers per-tab persistence).
 *
 * Repro + regression guard for [[TP-I05 Restored tab reverts to default agent
 * (view-state agentId clobbers per-tab persistence)]] (epic [[ACP Tab
 * Persistence Across Restarts]]). Also the root cause of Shared Links SLB-I6
 * (new/old link classification goes flat after reload).
 *
 * SYMPTOM: after an Obsidian restart, a tab restored from `perLeafTabStates`
 * (correct per-tab `agentId`, `sessionId`, and message history) comes back
 * under the WRONG agent — the default — and loses its rich state.
 *
 * MECHANISM (two restore paths conflict):
 *   1. Synchronous rich restore (correct): ChatView seeds
 *      `useTabManager(initialAgentId, restoredTabs, restoredActiveTabId)` from
 *      `perLeafTabStates` — restoredTabs carry the persisted per-tab `agentId`
 *      AND `tabId`, and `restoredMessages[tabId]` is keyed by that same tabId.
 *   2. Legacy Obsidian view-state restore (the bug): on reload `setState`
 *      restores a single view-state `initialAgentId` and fires
 *      `onAgentIdRestored`, whose ChatView effect called
 *      `tabManager.addTab(agentId)` UNCONDITIONALLY. That appended a spurious
 *      tab and activated it, shadowing the rich-restored active tab — wrong
 *      agent (TP-I05) and a fresh tabId with no `restoredMessages` entry, so it
 *      rehydrated from a diff-less `session/load` replay → flat link
 *      classification (SLB-I6).
 *
 * FIX: `shouldApplyViewStateAgentRestore` gates the view-state addTab on
 * whether the leaf was restored from persistence. This test exercises the real
 * decision function (imported, not a copy) plus the real `useTabManager`.
 *
 * Per SDLC § Stack-Trace Patch Anti-Pattern: the no-clobber assertion failed
 * (red) against the unconditional wiring, and passes once the guard is wired in.
 */

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabManager } from "../../hooks/useTabManager";
import type { TabInfo } from "../../types/tab";
import { shouldApplyViewStateAgentRestore } from "../viewStateAgentRestore";

const CLAUDE = "claude-code-acp";
const DEFAULT_AGENT = "auto-sa"; // plugin.settings.defaultAgentId in the repro

/** A tab restored synchronously from perLeafTabStates (persistedToRuntime). */
function restoredTab(tabId: string, agentId: string): TabInfo {
	return {
		tabId,
		agentId,
		label: "Claude Code session",
		labelIsCustom: false,
		state: "disconnected",
		createdAt: new Date("2026-06-25T00:00:00Z"),
	};
}

describe("TP-I05 — view-state agent restore must not clobber a persisted restore", () => {
	it("keeps the persisted Claude Code tab active after view-state restore (no spurious default tab)", () => {
		// Path 1: synchronous rich restore from perLeafTabStates.
		const restored = [restoredTab("T1", CLAUDE)];
		const { result } = renderHook(() =>
			useTabManager(CLAUDE, restored, "T1"),
		);

		// Sanity: the rich restore is correct before the view-state path runs.
		expect(result.current.tabs).toHaveLength(1);
		expect(result.current.activeTab.tabId).toBe("T1");
		expect(result.current.activeTab.agentId).toBe(CLAUDE);

		// Path 2: Obsidian setState restores a single view-state agent and
		// fires onAgentIdRestored. This leaf WAS restored from persistence, so
		// the guard must suppress the addTab.
		act(() => {
			if (
				shouldApplyViewStateAgentRestore({
					restoredFromPersistence: true,
				})
			) {
				result.current.addTab(DEFAULT_AGENT);
			}
		});

		// The view-state path must NOT clobber the rich restore.
		expect(result.current.tabs).toHaveLength(1);
		expect(result.current.activeTab.tabId).toBe("T1");
		expect(result.current.activeTab.agentId).toBe(CLAUDE);
	});

	it("still applies the view-state agent for a leaf with NO persisted restore (legacy path preserved)", () => {
		// A first-launch leaf: useTabManager creates its own initial tab; there
		// is no perLeafTabStates slice, so the view-state agent SHOULD apply.
		const { result } = renderHook(() => useTabManager(DEFAULT_AGENT));

		const before = result.current.tabs.length;
		act(() => {
			if (
				shouldApplyViewStateAgentRestore({
					restoredFromPersistence: false,
				})
			) {
				result.current.addTab(CLAUDE);
			}
		});

		// The legacy single-agent view-state restore must keep working when
		// there is nothing persisted to clobber. This is the guardrail the fix
		// must not break.
		expect(result.current.tabs.length).toBe(before + 1);
		expect(result.current.activeTab.agentId).toBe(CLAUDE);
	});
});
