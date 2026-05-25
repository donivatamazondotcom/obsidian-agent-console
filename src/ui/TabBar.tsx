/**
 * Tab bar component for multi-session support.
 *
 * Follows Obsidian's native tab bar conventions:
 * - Close button visible on active tab, hover-to-reveal on others
 * - `+` button at the end of the tab strip
 * - `˅` chevron for overflow tab list
 * - Right-click context menu (Close, Close others, Close to the right)
 * - Active tab background blends with content area
 * - Drag to reorder (no tear-off)
 */

import * as React from "react";
const { useRef, useEffect, useCallback, useTransition } = React;
import { Menu, setIcon, type MenuItem } from "obsidian";
import type { TabInfo, TabState } from "../types/tab";

// ============================================================================
// Props
// ============================================================================

export interface TabBarProps {
	tabs: TabInfo[];
	activeTabId: string;
	onSelectTab: (tabId: string) => void;
	onAddTab: () => void;
	onCloseTab: (tabId: string) => void;
	onCloseOtherTabs: (tabId: string) => void;
	onCloseTabsToRight: (tabId: string) => void;
	onRenameTab: (tabId: string) => void;
	onMoveTab: (fromIndex: number, toIndex: number) => void;
	/** Right-click on + button — show agent picker */
	onAddTabWithAgent?: (e: React.MouseEvent) => void;
}

// ============================================================================
// State Icon Component (Colorblind-Safe)
// ============================================================================

/**
 * Renders a tab state icon using shape + color + animation.
 * No red/green contrast dependency.
 */
function TabStateIcon({ state }: { state: TabState }) {
	const className = `agent-client-tab-state-icon agent-client-tab-state-${state}`;

	switch (state) {
		case "ready":
			return <span className={className}>●</span>;
		case "busy":
			return <span className={className}>◐</span>;
		case "permission":
			return <span className={className}>△</span>;
		case "error":
			return <span className={className}>✕</span>;
		case "disconnected":
			return <span className={className}>○</span>;
	}
}

// ============================================================================
// Single Tab Component
// ============================================================================

interface TabItemProps {
	tab: TabInfo;
	isActive: boolean;
	onSelect: () => void;
	onClose: () => void;
	onContextMenu: (e: React.MouseEvent) => void;
	onMiddleClick: () => void;
	onDragStart: (e: React.DragEvent) => void;
	onDragOver: (e: React.DragEvent) => void;
	onDrop: (e: React.DragEvent) => void;
}

function TabItem({
	tab,
	isActive,
	onSelect,
	onClose,
	onContextMenu,
	onMiddleClick,
	onDragStart,
	onDragOver,
	onDrop,
}: TabItemProps) {
	const closeRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (closeRef.current) {
			setIcon(closeRef.current, "x");
		}
	}, []);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			// Middle-click to close
			if (e.button === 1) {
				e.preventDefault();
				onMiddleClick();
			}
		},
		[onMiddleClick],
	);

	return (
		<div
			className={`agent-client-tab${isActive ? " agent-client-tab-active" : ""}`}
			onClick={onSelect}
			onContextMenu={onContextMenu}
			onMouseDown={handleMouseDown}
			draggable
			onDragStart={onDragStart}
			onDragOver={onDragOver}
			onDrop={onDrop}
		>
			<TabStateIcon state={tab.state} />
			<span className="agent-client-tab-label">{tab.label}</span>
			<div
				ref={closeRef}
				className="agent-client-tab-close clickable-icon"
				onClick={(e) => {
					e.stopPropagation();
					onClose();
				}}
				aria-label="Close tab"
			/>
		</div>
	);
}

// ============================================================================
// Tab Bar Component
// ============================================================================

export function TabBar({
	tabs,
	activeTabId,
	onSelectTab,
	onAddTab,
	onCloseTab,
	onCloseOtherTabs,
	onCloseTabsToRight,
	onRenameTab,
	onMoveTab,
	onAddTabWithAgent,
}: TabBarProps) {
	const addBtnRef = useRef<HTMLDivElement>(null);
	const chevronRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const dragIndexRef = useRef<number>(-1);

	// I-S10 round-3 fix: wrap tab-selection setState in a Transition so the
	// downstream re-render (including MessageList's heavy bubble mount on
	// activation of a 100+ message session) is marked low-priority. React
	// keeps the previously-active tab's already-revealed content painted
	// until the new tab's render commits — both the display:flex/none swap
	// AND the new tab's bubble mount commit together. No intermediate
	// empty-paint frame.
	//
	// Per React docs: "Transitions only 'wait' long enough to avoid hiding
	// *already revealed* content (like the tab container)."
	// — https://react.dev/reference/react/useTransition § "Preventing
	// unwanted loading indicators"
	//
	// `isPending` is intentionally not surfaced via UI yet — the tab
	// activation happens fast enough on real Chromium that a "pending"
	// indicator on the tab itself would flicker. If we ever want one, the
	// flag is right here ready to consume.
	const [, startSelectTabTransition] = useTransition();

	useEffect(() => {
		if (addBtnRef.current) setIcon(addBtnRef.current, "plus");
		if (chevronRef.current)
			setIcon(chevronRef.current, "chevron-down");
	}, []);

	// Scroll active tab into view — use rAF to ensure DOM class is applied
	useEffect(() => {
		requestAnimationFrame(() => {
			const container = scrollRef.current;
			if (!container) return;
			const activeEl = container.querySelector(
				".agent-client-tab-active",
			);
			if (!activeEl) return;

			const containerRect = container.getBoundingClientRect();
			const tabRect = activeEl.getBoundingClientRect();

			// Only scroll if the tab is outside the visible area
			if (tabRect.left < containerRect.left) {
				container.scrollLeft -=
					containerRect.left - tabRect.left;
			} else if (tabRect.right > containerRect.right) {
				container.scrollLeft +=
					tabRect.right - containerRect.right;
			}
		});
	}, [activeTabId]);

	// Right-click context menu on a tab (Obsidian Menu API)
	const handleTabContextMenu = useCallback(
		(e: React.MouseEvent, tab: TabInfo) => {
			e.preventDefault();
			const menu = new Menu();

			menu.addItem((item: MenuItem) => {
				item.setTitle("Rename").setIcon("pencil").onClick(() => {
					onRenameTab(tab.tabId);
				});
			});

			if (tabs.length > 1) {
				menu.addSeparator();

				menu.addItem((item: MenuItem) => {
					item.setTitle("Close").setIcon("x").onClick(() => {
						onCloseTab(tab.tabId);
					});
				});

				menu.addItem((item: MenuItem) => {
					item.setTitle("Close others").onClick(() => {
						onCloseOtherTabs(tab.tabId);
					});
				});

				const tabIdx = tabs.findIndex(
					(t) => t.tabId === tab.tabId,
				);
				if (tabIdx < tabs.length - 1) {
					menu.addItem((item: MenuItem) => {
						item.setTitle("Close to the right").onClick(
							() => {
								onCloseTabsToRight(tab.tabId);
							},
						);
					});
				}
			}

			menu.showAtMouseEvent(e.nativeEvent);
		},
		[tabs, onCloseTab, onCloseOtherTabs, onCloseTabsToRight, onRenameTab],
	);

	// Chevron dropdown — list all tabs
	const handleChevronClick = useCallback(
		(e: React.MouseEvent) => {
			const menu = new Menu();
			for (const tab of tabs) {
				menu.addItem((item: MenuItem) => {
					item.setTitle(tab.label)
						.setChecked(tab.tabId === activeTabId)
						.onClick(() => {
							startSelectTabTransition(() => {
								onSelectTab(tab.tabId);
							});
						});
				});
			}
			menu.showAtMouseEvent(e.nativeEvent);
		},
		[tabs, activeTabId, onSelectTab],
	);

	// Drag handlers
	const handleDragStart = useCallback(
		(index: number) => (e: React.DragEvent) => {
			dragIndexRef.current = index;
			e.dataTransfer.effectAllowed = "move";
		},
		[],
	);

	const handleDragOver = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.dataTransfer.dropEffect = "move";
		},
		[],
	);

	const handleDrop = useCallback(
		(toIndex: number) => (e: React.DragEvent) => {
			e.preventDefault();
			const fromIndex = dragIndexRef.current;
			if (fromIndex !== -1 && fromIndex !== toIndex) {
				onMoveTab(fromIndex, toIndex);
			}
			dragIndexRef.current = -1;
		},
		[onMoveTab],
	);

	// Horizontal scroll on wheel
	const handleWheel = useCallback((e: React.WheelEvent) => {
		if (scrollRef.current) {
			scrollRef.current.scrollLeft += e.deltaY;
		}
	}, []);

	return (
		<div className="agent-client-tab-bar">
			<div
				className="agent-client-tab-bar-scroll"
				ref={scrollRef}
				onWheel={handleWheel}
			>
				{tabs.map((tab, index) => (
					<TabItem
						key={tab.tabId}
						tab={tab}
						isActive={tab.tabId === activeTabId}
						onSelect={() =>
							startSelectTabTransition(() => {
								onSelectTab(tab.tabId);
							})
						}
						onClose={() => onCloseTab(tab.tabId)}
						onContextMenu={(e) =>
							handleTabContextMenu(e, tab)
						}
						onMiddleClick={() => onCloseTab(tab.tabId)}
						onDragStart={handleDragStart(index)}
						onDragOver={handleDragOver}
						onDrop={handleDrop(index)}
					/>
				))}
			</div>
			<div
				ref={addBtnRef}
				className="clickable-icon agent-client-tab-bar-add"
				aria-label="New session tab"
				onClick={onAddTab}
				onContextMenu={onAddTabWithAgent}
			/>
			<div
				ref={chevronRef}
				className="clickable-icon agent-client-tab-bar-chevron"
				aria-label="Tab list"
				onClick={handleChevronClick}
			/>
		</div>
	);
}
