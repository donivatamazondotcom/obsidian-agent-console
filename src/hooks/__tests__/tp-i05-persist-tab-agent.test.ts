/**
 * TP-I05 — switching a tab's agent must update the persisted source of truth
 * (`TabInfo.agentId`), so a restart restores the switched agent, not the stale
 * create-time default.
 *
 * Repro for [[TP-I05 Restored tab reverts to default agent (view-state agentId
 * clobbers per-tab persistence)]] (real cause) + design D1 in
 * [[Tab Agent Identity and Session Acquisition Unification]].
 *
 * SYMPTOM: a Kiro CLI tab restored as the default agent after restart, because
 * the agent switch updated only `session.agentId` + the Obsidian view-state,
 * never `TabInfo.agentId` — and `buildPerLeafState` persists `TabInfo.agentId`.
 *
 * Per SDLC § Stack-Trace Patch Anti-Pattern: this models switch→persist (the
 * step the earlier reproduce-first test missed by hard-coding the persisted
 * agentId). RED until `useTabManager` gains `setTabAgent` and it mutates the
 * tab's agentId; GREEN after.
 */

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabManager } from "../useTabManager";

describe("TP-I05 — setTabAgent updates the persisted tab agent", () => {
	it("a switched agent becomes the tab's agentId (the value perLeafTabStates persists)", () => {
		const { result } = renderHook(() => useTabManager("test-agent"));
		const t1 = result.current.activeTabId;
		expect(result.current.activeTab!.agentId).toBe("test-agent");

		// User switches the tab to Kiro CLI. The tab's agentId — the value
		// buildPerLeafState persists and restore reads — MUST become kiro-cli.
		// Optional-chain so the pre-fix run is a no-op (value-red), not a throw.
		act(() => {
			(
				result.current as unknown as {
					setTabAgent?: (tabId: string, agentId: string) => void;
				}
			).setTabAgent?.(t1, "kiro-cli");
		});

		expect(result.current.tabs[0].agentId).toBe("kiro-cli");
		expect(result.current.activeTab!.agentId).toBe("kiro-cli");
	});

	it("setTabAgent only touches the targeted tab", () => {
		const { result } = renderHook(() => useTabManager("test-agent"));
		let t2 = "";
		act(() => {
			t2 = result.current.addTab("test-agent");
		});
		const t1 = result.current.tabs[0].tabId;

		act(() => {
			(
				result.current as unknown as {
					setTabAgent?: (tabId: string, agentId: string) => void;
				}
			).setTabAgent?.(t2, "kiro-cli");
		});

		expect(result.current.tabs.find((t) => t.tabId === t2)?.agentId).toBe(
			"kiro-cli",
		);
		expect(result.current.tabs.find((t) => t.tabId === t1)?.agentId).toBe(
			"test-agent",
		);
	});
});
