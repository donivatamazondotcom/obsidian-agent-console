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
const { useRef, useEffect, useCallback } = React;
import { Menu, setIcon, setTooltip, type MenuItem } from "obsidian";
import { registerOpenMenu, showMenuAtEvent } from "../utils/menu-registry";
import type { TabInfo, TabState } from "../types/tab";
import { t } from "../i18n";

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
	/**
	 * Register a callback that opens the tab list, so the `show-tab-list`
	 * plugin command (hotkey-bindable) can trigger it. The registered fn
	 * clicks the chevron, reusing the exact same menu path as a mouse click.
	 */
	onRegisterShowTabList?: (fn: () => void) => void;
}

// ============================================================================
// State Icon Component (Colorblind-Safe)
// ============================================================================

/**
 * Maps a tab state to its colorblind-safe glyph.
 *
 * Single source of truth shared by the strip's {@link TabStateIcon} and the
 * chevron dropdown (handleChevronClick), so the two surfaces can never drift.
 * Shape is the primary signal by design — see `types/tab.ts`.
 */
export function stateGlyph(state: TabState): string {
	switch (state) {
		case "ready":
			return "●";
		case "busy":
			return "◐";
		case "permission":
			return "△";
		case "error":
			return "✕";
		case "disconnected":
			return "○";
	}
}

/**
 * Renders a tab state icon using shape + color + animation.
 * No red/green contrast dependency.
 */
function TabStateIcon({ state }: { state: TabState }) {
	const className = `agent-client-tab-state-icon agent-client-tab-state-${state}`;
	return <span className={className}>{stateGlyph(state)}</span>;
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
	const tabRef = useRef<HTMLDivElement>(null);
	const closeRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (closeRef.current) {
			setIcon(closeRef.current, "x");
		}
	}, []);

	// Full label as a hover tooltip. The label is CSS-truncated
	// (text-overflow: ellipsis; max-width), so a long note title shows as
	// "Long note titl…" with no way to read it. Obsidian's native leaf tabs
	// reveal the full title on hover; mirror that with setTooltip (themed,
	// consistent with ChatHeader/SettingsTab) rather than the raw `title`
	// attribute. Re-runs when the label changes (e.g. AI rename) so the
	// tooltip never goes stale.
	useEffect(() => {
		if (tabRef.current) {
			setTooltip(tabRef.current, tab.label);
		}
	}, [tab.label]);

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
			ref={tabRef}
			className={`agent-client-tab${isActive ? " agent-client-tab-active" : ""}`}
			role="tab"
			tabIndex={0}
			aria-selected={isActive}
			onClick={onSelect}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSelect();
				}
			}}
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
				role="button"
				tabIndex={0}
				onClick={(e) => {
					e.stopPropagation();
					onClose();
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						e.stopPropagation();
						onClose();
					}
				}}
				aria-label={t("chat.tabBar.closeTab")}
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
	onRegisterShowTabList,
}: TabBarProps) {
	const addBtnRef = useRef<HTMLButtonElement>(null);
	const chevronRef = useRef<HTMLButtonElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const dragIndexRef = useRef<number>(-1);

	// I-S10 round-4 note: a round-3 attempt wrapped tab-selection
	// setState in `useTransition` to keep the click handler snappy. That
	// turned out to introduce a perception-time regression — the
	// post-commit markdown rendering inside MessageBubble's useEffect
	// became visible as a scrollbar-pill flicker. The synchronous path
	// (which is what the keyboard hotkey uses, via plugin command →
	// ChatView.nextTab() → tabManager.setActiveTabId) blocks the main
	// thread end-to-end during activation but produces only one final
	// paint with no flicker, which the user prefers. The mechanism is
	// proven in src/ui/__tests__/post-commit-effect-mechanism.test.tsx.
	// See [[ACP Scroll Architecture Rework]] § I-S10 § Round-3 verification.

	useEffect(() => {
		if (addBtnRef.current) setIcon(addBtnRef.current, "plus");
		if (chevronRef.current)
			setIcon(chevronRef.current, "chevron-down");
	}, []);

	// Expose "open the tab list" to the plugin's show-tab-list command
	// (hotkey-bindable). Clicking the chevron synthesizes a click with
	// detail === 0 / clientX,Y === 0 — the exact signature showMenuAtEvent
	// (I115) anchors to the chevron rect — so a keyboard/command-triggered
	// tab list pops from the chevron, not the viewport origin, and reuses the
	// identical menu-building path as a mouse click (no second code path).
	const showTabList = useCallback(() => {
		chevronRef.current?.click();
	}, []);

	useEffect(() => {
		onRegisterShowTabList?.(showTabList);
	}, [onRegisterShowTabList, showTabList]);

	// Scroll active tab into view — use rAF to ensure DOM class is applied
	useEffect(() => {
		window.requestAnimationFrame(() => {
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
			registerOpenMenu(menu);

			menu.addItem((item: MenuItem) => {
				item.setTitle(t("chat.tabBar.rename")).setIcon("pencil").onClick(() => {
					onRenameTab(tab.tabId);
				});
			});

			menu.addSeparator();

			// Close is always available — closing the last tab lands on the
			// zero-tab landing screen (reverses T06/T41/I23 for this path).
			menu.addItem((item: MenuItem) => {
				item.setTitle(t("chat.tabBar.close")).setIcon("x").onClick(() => {
					onCloseTab(tab.tabId);
				});
			});

			// "Close others" / "Close to the right" only apply with >1 tab.
			if (tabs.length > 1) {
				menu.addItem((item: MenuItem) => {
					item.setTitle(t("chat.tabBar.closeOthers")).onClick(() => {
						onCloseOtherTabs(tab.tabId);
					});
				});

				const tabIdx = tabs.findIndex(
					(t) => t.tabId === tab.tabId,
				);
				if (tabIdx < tabs.length - 1) {
					menu.addItem((item: MenuItem) => {
						item.setTitle(t("chat.tabBar.closeToRight")).onClick(
							() => {
								onCloseTabsToRight(tab.tabId);
							},
						);
					});
				}
			}

			showMenuAtEvent(menu, e);
		},
		[tabs, onCloseTab, onCloseOtherTabs, onCloseTabsToRight, onRenameTab],
	);

	// Chevron dropdown — list all tabs
	const handleChevronClick = useCallback(
		(e: React.MouseEvent) => {
			const menu = new Menu();
			registerOpenMenu(menu);
			for (const tab of tabs) {
				menu.addItem((item: MenuItem) => {
					item.setTitle(`${stateGlyph(tab.state)}  ${tab.label}`)
						.setChecked(tab.tabId === activeTabId)
						.onClick(() => {
							onSelectTab(tab.tabId);
						});
				});
			}
			showMenuAtEvent(menu, e);
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
						onSelect={() => onSelectTab(tab.tabId)}
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
			<button
				ref={addBtnRef}
				type="button"
				className="clickable-icon agent-client-tab-bar-add"
				aria-label={t("chat.tabBar.newSessionTab")}
				onClick={onAddTab}
				onContextMenu={onAddTabWithAgent}
			/>
			<button
				ref={chevronRef}
				type="button"
				className="clickable-icon agent-client-tab-bar-chevron"
				aria-label={t("chat.tabBar.tabList")}
				onClick={handleChevronClick}
			/>
		</div>
	);
}
