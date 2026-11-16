/**
 * Default tab names and the "still has its default name" flag (Session Title
 * in the Chat Header, Test 7).
 *
 * The chat header now shows the tab's name as its title, so the default name
 * must read as the agent's display name, not its id (`Claude Code 08:14 AM`,
 * not `claude-code-acp 08:14 AM`), and the header must know when the name is
 * still the default (it then leaves out the grey agent name, which the title
 * already says). `useTabManager` owns both.
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useTabManager } from "../useTabManager";

const NAMES: Record<string, string> = {
	"claude-code-acp": "Claude Code",
	"kiro-cli": "Team Agent",
};
const displayNameFor = (id: string) => NAMES[id] ?? id;

/** Default label shape: "<name> <time>". The time format depends on locale. */
const startsWithName = (label: string, name: string) =>
	label.startsWith(`${name} `) && label.length > name.length + 1;

describe("default tab name uses the agent's display name", () => {
	it("a new tab is named after the agent's display name and is flagged default", () => {
		const { result } = renderHook(() =>
			useTabManager("claude-code-acp", undefined, undefined, displayNameFor),
		);
		const tab = result.current.activeTab!;
		expect(startsWithName(tab.label, "Claude Code")).toBe(true);
		expect(tab.label.startsWith("claude-code-acp")).toBe(false);
		expect(tab.labelIsDefault).toBe(true);
	});

	it("a tab added without a label gets the default name; with a label it doesn't", () => {
		const { result } = renderHook(() =>
			useTabManager("claude-code-acp", undefined, undefined, displayNameFor),
		);
		let plain = "";
		let named = "";
		act(() => {
			plain = result.current.addTab("kiro-cli");
			named = result.current.addTab("kiro-cli", "Explain vector embeddings");
		});
		const byId = (id: string) => result.current.tabs.find((t) => t.tabId === id)!;
		expect(startsWithName(byId(plain).label, "Team Agent")).toBe(true);
		expect(byId(plain).labelIsDefault).toBe(true);
		expect(byId(named).label).toBe("Explain vector embeddings");
		expect(byId(named).labelIsDefault).toBe(false);
	});

	it("without displayNameFor the id is used (existing callers unchanged)", () => {
		const { result } = renderHook(() => useTabManager("claude-code-acp"));
		expect(startsWithName(result.current.activeTab!.label, "claude-code-acp")).toBe(true);
		expect(result.current.activeTab!.labelIsDefault).toBe(true);
	});

	it("a renamed agent's new display name is used without re-creating the hook", () => {
		const names = { current: "Claude Code" };
		const { result } = renderHook(() =>
			useTabManager("claude-code-acp", undefined, undefined, () => names.current),
		);
		names.current = "Claude (work)";
		let id = "";
		act(() => {
			id = result.current.addTab("claude-code-acp");
		});
		expect(
			startsWithName(result.current.tabs.find((t) => t.tabId === id)!.label, "Claude (work)"),
		).toBe(true);
	});
});

describe("labelIsDefault is set and cleared by the tab manager", () => {
	it("setTabLabel clears it, auto-derived or custom", () => {
		const { result } = renderHook(() =>
			useTabManager("claude-code-acp", undefined, undefined, displayNameFor),
		);
		const id = result.current.activeTabId;
		act(() => result.current.setTabLabel(id, "Debug the failing CI pipeline"));
		expect(result.current.activeTab!.labelIsDefault).toBe(false);

		act(() => result.current.resetTab(id));
		expect(result.current.activeTab!.labelIsDefault).toBe(true);
		act(() => result.current.setTabLabel(id, "My rename", true));
		expect(result.current.activeTab!.labelIsDefault).toBe(false);
	});

	it("setTabLabel with the same text as the default name still clears it", () => {
		const { result } = renderHook(() =>
			useTabManager("claude-code-acp", undefined, undefined, displayNameFor),
		);
		const tab = result.current.activeTab!;
		act(() => result.current.setTabLabel(tab.tabId, tab.label));
		expect(result.current.activeTab!.label).toBe(tab.label);
		expect(result.current.activeTab!.labelIsDefault).toBe(false);
	});

	it("resetTab sets it and renames the tab after its agent", () => {
		const { result } = renderHook(() =>
			useTabManager("claude-code-acp", undefined, undefined, displayNameFor),
		);
		const id = result.current.activeTabId;
		act(() => result.current.setTabLabel(id, "Something else", true));
		act(() => result.current.resetTab(id));
		expect(startsWithName(result.current.activeTab!.label, "Claude Code")).toBe(true);
		expect(result.current.activeTab!.labelIsDefault).toBe(true);
		expect(result.current.activeTab!.labelIsCustom).toBe(false);
	});

	it("setTabAgent then resetTab names the new agent (agent-switch order)", () => {
		const { result } = renderHook(() =>
			useTabManager("kiro-cli", undefined, undefined, displayNameFor),
		);
		const id = result.current.activeTabId;
		act(() => {
			result.current.setTabAgent(id, "claude-code-acp");
			result.current.resetTab(id);
		});
		const label = result.current.activeTab!.label;
		expect(startsWithName(label, "Claude Code")).toBe(true);
		expect(label.startsWith("Team Agent")).toBe(false);
	});

	it("addTab can restore a default-named tab (reopen closed tab)", () => {
		const { result } = renderHook(() =>
			useTabManager("claude-code-acp", undefined, undefined, displayNameFor),
		);
		let id = "";
		act(() => {
			id = result.current.addTab("claude-code-acp", "Claude Code 08:14 AM", true, "restored", true);
		});
		const tab = result.current.tabs.find((t) => t.tabId === id)!;
		expect(tab.label).toBe("Claude Code 08:14 AM");
		expect(tab.labelIsDefault).toBe(true);
	});
});
