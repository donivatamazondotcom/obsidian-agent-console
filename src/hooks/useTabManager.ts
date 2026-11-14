/**
 * Hook for managing tabbed sessions within a single ChatView.
 *
 * Each tab represents an independent agent session. The hook manages
 * the tab list, active tab, and tab metadata (label, state).
 * Tab creation/destruction of AcpClient instances is handled by the
 * parent ChatView via plugin.getOrCreateAcpClient(tabId).
 */

import { useState, useCallback, useMemo, useRef } from "react";
import type { TabInfo, TabOrigin, TabState } from "../types/tab";

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
	addTab: (
		agentId: string,
		label?: string,
		activate?: boolean,
		origin?: TabOrigin,
		/** Restore a default-named tab with its saved label (reopen closed tab). */
		labelIsDefault?: boolean,
	) => string;
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
	/** Reset a tab's label to the default name for its current agent and its state to disconnected (New chat, agent switch, error boundary retry) */
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

/** Maps an agent id to the name users see. Falls back to the id. */
export type DisplayNameFor = (agentId: string) => string;

const idAsName: DisplayNameFor = (agentId) => agentId;

/** The default tab name: "<agent display name> <time>". */
function defaultLabel(agentId: string, displayNameFor: DisplayNameFor): string {
	const name = displayNameFor(agentId) || agentId;
	return `${name} ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function createTab(
	agentId: string,
	displayNameFor: DisplayNameFor,
	label?: string,
	origin: TabOrigin = "fresh",
	labelIsDefault?: boolean,
): TabInfo {
	return {
		tabId: generateTabId(),
		agentId,
		origin,
		label: label || defaultLabel(agentId, displayNameFor),
		labelIsCustom: false,
		labelIsDefault: !label || labelIsDefault === true,
		state: "disconnected",
		createdAt: new Date(),
	};
}

import { truncateLabel } from "../utils/tab-label";
export { truncateLabel, suffixOnCollision } from "../utils/tab-label";

// ============================================================================
// Hook
// ============================================================================

/**
 * Manages tab state for a single ChatView.
 *
 * @param initialAgentId - Agent ID for the first tab (created on mount)
 * @param initialTabs - Optional pre-built tabs (used for restoration from persistence)
 * @param initialActiveTabId - Optional active tab ID (used with initialTabs)
 * @param displayNameFor - Optional agent-id → display-name lookup for default
 *   tab names. Read at call time through a ref, so a renamed agent's new name
 *   is used and the returned callbacks stay stable. Falls back to the id.
 */
export function useTabManager(
	initialAgentId: string,
	initialTabs?: TabInfo[],
	initialActiveTabId?: string,
	displayNameFor?: DisplayNameFor,
): UseTabManagerReturn {
	const displayNameRef = useRef<DisplayNameFor>(displayNameFor ?? idAsName);
	displayNameRef.current = displayNameFor ?? idAsName;
	const nameFor: DisplayNameFor = (id) => displayNameRef.current(id);

	const [tabs, setTabs] = useState<TabInfo[]>(() => {
		// `undefined` = no persisted state → fresh mount, create one tab.
		// `[]` = a restored, intentional zero-tab landing (Decision 5) → honor
		// it so a restart lands on the landing screen instead of auto-spawning.
		if (initialTabs !== undefined) {
			return initialTabs;
		}
		const first = createTab(initialAgentId, nameFor);
		return [first];
	});
	const [activeTabId, setActiveTabId] = useState<string>(
		() => initialActiveTabId ?? tabs[0]?.tabId ?? "",
	);
	// Latest tabs for the setActiveTab guard, read through a ref so the
	// returned setter keeps a stable identity and adds no state update to the
	// synchronous tab-click path.
	const tabsRef = useRef(tabs);
	tabsRef.current = tabs;

	/**
	 * Activate an open tab. Ignores ids that are not in `tabs`: a closed tab's
	 * notification handler (I52 round 9) or a stale tab-list menu can hold an
	 * id that no longer exists, and activating it hides every panel.
	 */
	const setActiveTab = useCallback((tabId: string) => {
		if (tabsRef.current.some((t) => t.tabId === tabId)) {
			setActiveTabId(tabId);
		}
	}, []);

	const addTab = useCallback(
		(
			agentId: string,
			label?: string,
			activate = true,
			origin: TabOrigin = "fresh",
			labelIsDefault?: boolean,
		): string => {
			const tab = createTab(
				agentId,
				(id) => displayNameRef.current(id),
				label,
				origin,
				labelIsDefault,
			);
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

	const removeOtherTabs = useCallback((tabId: string) => {
		setTabs((prev) => prev.filter((t) => t.tabId === tabId));
		setActiveTabId(tabId);
	}, []);

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
				if (
					tab.label === truncated &&
					tab.labelIsCustom === nextCustom &&
					tab.labelIsDefault !== true
				)
					return prev;
				return prev.map((t) =>
					t.tabId === tabId
						? {
								...t,
								label: truncated,
								labelIsCustom: nextCustom,
								labelIsDefault: false,
							}
						: t,
				);
			});
		},
		[],
	);

	const setTabState = useCallback((tabId: string, state: TabState) => {
		setTabs((prev) => {
			const tab = prev.find((t) => t.tabId === tabId);
			if (!tab || tab.state === state) return prev;
			return prev.map((t) => (t.tabId === tabId ? { ...t, state } : t));
		});
	}, []);

	const setTabAgent = useCallback((tabId: string, agentId: string) => {
		setTabs((prev) => {
			const tab = prev.find((t) => t.tabId === tabId);
			if (!tab || tab.agentId === agentId) return prev;
			return prev.map((t) => (t.tabId === tabId ? { ...t, agentId } : t));
		});
	}, []);

	const resetTab = useCallback((tabId: string) => {
		setTabs((prev) =>
			prev.map((t) =>
				t.tabId === tabId
					? {
							...t,
							label: defaultLabel(t.agentId, displayNameRef.current),
							labelIsCustom: false,
							labelIsDefault: true,
							state: "disconnected",
						}
					: t,
			),
		);
	}, []);

	const moveTab = useCallback((fromIndex: number, toIndex: number) => {
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
	}, []);

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
		() => tabs.find((t) => t.tabId === activeTabId) ?? tabs[0] ?? null,
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
			setActiveTab,
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
			setActiveTab,
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
