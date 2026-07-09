/**
 * Hook for managing tabbed sessions within a single ChatView.
 *
 * Each tab represents an independent agent session. The hook manages
 * the tab list, active tab, and tab metadata (label, state).
 * Tab creation/destruction of AcpClient instances is handled by the
 * parent ChatView via plugin.getOrCreateAcpClient(tabId).
 */

import { useState, useCallback, useMemo } from "react";
import type { TabInfo, TabState } from "../types/tab";

// ============================================================================
// Types
// ============================================================================

export interface UseTabManagerReturn {
	/** All tabs in order */
	tabs: TabInfo[];
	/** Currently active tab ID */
	activeTabId: string;
	/** Currently active tab info, or null when no tabs are open (zero-tab landing). */
	activeTab: TabInfo | null;
	/** Add a new tab. Activates it unless `activate` is false (background open). */
	addTab: (agentId: string, label?: string, activate?: boolean) => string;
	/** Remove a tab by ID. Returns the new active tab ID. */
	removeTab: (tabId: string) => string | null;
	/** Remove all tabs except the given one */
	removeOtherTabs: (tabId: string) => void;
	/** Remove all tabs to the right of the given one */
	removeTabsToRight: (tabId: string) => void;
	/** Switch to a tab */
	setActiveTab: (tabId: string) => void;
	/** Update a tab's label */
	setTabLabel: (tabId: string, label: string, custom?: boolean) => void;
	/** Update a tab's visual state */
	setTabState: (tabId: string, state: TabState) => void;
	/** Update a tab's bound agent — the single source of truth, persisted (TP-I05). */
	setTabAgent: (tabId: string, agentId: string) => void;
	/** Reset a tab's label and state to defaults (used after error boundary retry) */
	resetTab: (tabId: string) => void;
	/** Reorder: move tab from one index to another */
	moveTab: (fromIndex: number, toIndex: number) => void;
	/** Switch to next tab (cyclic) */
	nextTab: () => void;
	/** Switch to previous tab (cyclic) */
	prevTab: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function generateTabId(): string {
	return `tab-${crypto.randomUUID().slice(0, 8)}`;
}

function defaultLabel(agentId: string): string {
	return `${agentId} ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function createTab(agentId: string, label?: string): TabInfo {
	return {
		tabId: generateTabId(),
		agentId,
		label: label || defaultLabel(agentId),
		labelIsCustom: false,
		state: "disconnected",
		createdAt: new Date(),
	};
}

export function truncateLabel(text: string, max = 100): string {
	return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/**
 * F03 — disambiguate an auto-applied tab label against other open tabs'
 * labels with a filesystem-style numeric suffix.
 *
 * `Fix scroll jitter` → `Fix scroll jitter (2)` → `Fix scroll jitter (3)` …
 *
 * Pure: takes the candidate label and the labels of the OTHER tabs (caller
 * excludes the tab being labeled). Returns the candidate unchanged when there
 * is no collision. Applied at apply time only — never retroactively renumbered
 * when a sibling closes. Manual renames are NOT suffixed (they reject
 * duplicates instead — T40/I22); this is for auto-applied titles only.
 */
export function suffixOnCollision(
	label: string,
	otherLabels: string[],
): string {
	const taken = new Set(otherLabels);
	if (!taken.has(label)) return label;
	let n = 2;
	while (taken.has(`${label} (${n})`)) n += 1;
	return `${label} (${n})`;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Manages tab state for a single ChatView.
 *
 * @param initialAgentId - Agent ID for the first tab (created on mount)
 * @param initialTabs - Optional pre-built tabs (used for restoration from persistence)
 * @param initialActiveTabId - Optional active tab ID (used with initialTabs)
 */
export function useTabManager(
	initialAgentId: string,
	initialTabs?: TabInfo[],
	initialActiveTabId?: string,
): UseTabManagerReturn {
	const [tabs, setTabs] = useState<TabInfo[]>(() => {
		// `undefined` = no persisted state → fresh mount, create one tab.
		// `[]` = a restored, intentional zero-tab landing (Decision 5) → honor
		// it so a restart lands on the landing screen instead of auto-spawning.
		if (initialTabs !== undefined) {
			return initialTabs;
		}
		const first = createTab(initialAgentId);
		return [first];
	});
	const [activeTabId, setActiveTabId] = useState<string>(
		() => initialActiveTabId ?? tabs[0]?.tabId ?? "",
	);

	const addTab = useCallback(
		(agentId: string, label?: string, activate = true): string => {
			const tab = createTab(agentId, label);
			setTabs((prev) => [...prev, tab]);
			// Background open (activate:false) appends without switching — the
			// new tab still mounts (all tabs render) and consumes its
			// initialPrompt, so a background quick-prompt fire sends without
			// stealing focus from the user's current tab.
			if (activate) setActiveTabId(tab.tabId);
			return tab.tabId;
		},
		[],
	);

	const removeTab = useCallback(
		(tabId: string): string | null => {
			let newActiveId: string | null = null;
			setTabs((prev) => {
				const idx = prev.findIndex((t) => t.tabId === tabId);
				if (idx === -1) return prev;
				const next = prev.filter((t) => t.tabId !== tabId);
				// Closing the last tab is allowed: fall back to a zero-tab
				// landing state with no active tab (Decision 1). removeTab
				// returns null so callers know nothing is active.
				if (next.length === 0) {
					newActiveId = null;
					setActiveTabId("");
					return next;
				}
				// If removing the active tab, activate the nearest neighbor
				if (tabId === activeTabId) {
					const newIdx = Math.min(idx, next.length - 1);
					newActiveId = next[newIdx].tabId;
					setActiveTabId(newActiveId);
				} else {
					newActiveId = activeTabId;
				}
				return next;
			});
			return newActiveId;
		},
		[activeTabId],
	);

	const removeOtherTabs = useCallback(
		(tabId: string) => {
			setTabs((prev) => prev.filter((t) => t.tabId === tabId));
			setActiveTabId(tabId);
		},
		[],
	);

	const removeTabsToRight = useCallback(
		(tabId: string) => {
			setTabs((prev) => {
				const idx = prev.findIndex((t) => t.tabId === tabId);
				if (idx === -1) return prev;
				return prev.slice(0, idx + 1);
			});
			// If active tab was to the right, switch to the kept tab
			setTabs((prev) => {
				if (!prev.find((t) => t.tabId === activeTabId)) {
					setActiveTabId(tabId);
				}
				return prev;
			});
		},
		[activeTabId],
	);

	const setTabLabel = useCallback(
		(tabId: string, label: string, custom = false) => {
			const truncated = truncateLabel(label);
			setTabs((prev) => {
				const tab = prev.find((t) => t.tabId === tabId);
				if (!tab) return prev;
				// Auto-derived labels (custom=false) must not overwrite a
				// manual rename (I56).
				if (!custom && tab.labelIsCustom) return prev;
				const nextCustom = custom || tab.labelIsCustom === true;
				if (tab.label === truncated && tab.labelIsCustom === nextCustom)
					return prev;
				return prev.map((t) =>
					t.tabId === tabId
						? { ...t, label: truncated, labelIsCustom: nextCustom }
						: t,
				);
			});
		},
		[],
	);

	const setTabState = useCallback(
		(tabId: string, state: TabState) => {
			setTabs((prev) => {
				const tab = prev.find((t) => t.tabId === tabId);
				if (!tab || tab.state === state) return prev;
				return prev.map((t) =>
					t.tabId === tabId ? { ...t, state } : t,
				);
			});
		},
		[],
	);

	const setTabAgent = useCallback((tabId: string, agentId: string) => {
		setTabs((prev) => {
			const tab = prev.find((t) => t.tabId === tabId);
			if (!tab || tab.agentId === agentId) return prev;
			return prev.map((t) =>
				t.tabId === tabId ? { ...t, agentId } : t,
			);
		});
	}, []);

	const resetTab = useCallback((tabId: string) => {
		setTabs((prev) =>
			prev.map((t) =>
				t.tabId === tabId
					? {
							...t,
							label: defaultLabel(t.agentId),
							labelIsCustom: false,
							state: "disconnected",
					  }
					: t,
			),
		);
	}, []);

	const moveTab = useCallback(
		(fromIndex: number, toIndex: number) => {
			setTabs((prev) => {
				if (
					fromIndex < 0 ||
					fromIndex >= prev.length ||
					toIndex < 0 ||
					toIndex >= prev.length
				)
					return prev;
				const next = [...prev];
				const [moved] = next.splice(fromIndex, 1);
				next.splice(toIndex, 0, moved);
				return next;
			});
		},
		[],
	);

	const nextTab = useCallback(() => {
		setTabs((prev) => {
			if (prev.length === 0) return prev; // No tabs → nothing to cycle.
			const idx = prev.findIndex((t) => t.tabId === activeTabId);
			const nextIdx = (idx + 1) % prev.length;
			setActiveTabId(prev[nextIdx].tabId);
			return prev;
		});
	}, [activeTabId]);

	const prevTab = useCallback(() => {
		setTabs((prev) => {
			if (prev.length === 0) return prev; // No tabs → nothing to cycle.
			const idx = prev.findIndex((t) => t.tabId === activeTabId);
			const prevIdx = (idx - 1 + prev.length) % prev.length;
			setActiveTabId(prev[prevIdx].tabId);
			return prev;
		});
	}, [activeTabId]);

	const activeTab = useMemo(
		() =>
			tabs.find((t) => t.tabId === activeTabId) ?? tabs[0] ?? null,
		[tabs, activeTabId],
	);

	return useMemo(
		() => ({
			tabs,
			activeTabId,
			activeTab,
			addTab,
			removeTab,
			removeOtherTabs,
			removeTabsToRight,
			setActiveTab: setActiveTabId,
			setTabLabel,
			setTabState,
			setTabAgent,
			resetTab,
			moveTab,
			nextTab,
			prevTab,
		}),
		[
			tabs,
			activeTabId,
			activeTab,
			addTab,
			removeTab,
			removeOtherTabs,
			removeTabsToRight,
			setTabLabel,
			setTabState,
			setTabAgent,
			resetTab,
			moveTab,
			nextTab,
			prevTab,
		],
	);
}
