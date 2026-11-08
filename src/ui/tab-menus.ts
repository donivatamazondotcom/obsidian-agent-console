/**
 * Tab menus shared by the tab strip (TabBar) and the vertical tab rail
 * (TabRail): the right-click context menu and the chevron tab list. One
 * implementation so both surfaces offer the same actions
 * ([[Agent Console Vertical Tab Rail]] § Reusing the strip's code).
 */

import type * as React from "react";
import { Menu, setIcon, type MenuItem } from "obsidian";
import { registerOpenMenu, showMenuAtEvent } from "../utils/menu-registry";
import type { TabInfo } from "../types/tab";
import { t } from "../i18n";
import type { AiRenameAffordance } from "../resolvers/ai-rename-affordance";
import { stateIcon, stateIconClass } from "./tab-state-icon";

/**
 * I210 — the "Rename with AI" menu title. When the tab's agent can't close
 * the side session, the disabled item carries a muted second line saying so,
 * since a native menu item has no tooltip.
 */
function aiRenameMenuTitle(
	affordance: AiRenameAffordance,
): string | DocumentFragment {
	const label = t("chat.tabBar.renameWithAi");
	if (
		affordance.kind !== "disabled" ||
		affordance.reason !== "agent-cannot-close"
	) {
		return label;
	}
	return createFragment((frag) => {
		frag.createDiv({ text: label });
		frag.createDiv({
			text: t("chat.tabBar.renameWithAiUnavailable"),
			cls: "agent-client-menu-item-note",
		});
	});
}

export interface TabContextMenuContext {
	tabs: TabInfo[];
	onCloseTab: (tabId: string) => void;
	onCloseOtherTabs: (tabId: string) => void;
	onCloseTabsToRight: (tabId: string) => void;
	onRenameTab: (tabId: string) => void;
	onAiRenameTab?: (tabId: string) => void;
	aiRenamingTabIds?: ReadonlySet<string>;
	getAiRenameAffordance?: (tabId: string) => AiRenameAffordance;
	/**
	 * The rail lists tabs top to bottom, so "Close to the right" reads
	 * "Close below" there. Same action either way.
	 */
	orientation: "horizontal" | "vertical";
}

/** Right-click (or keyboard context-menu) menu for one tab. */
export function showTabContextMenu(
	e: React.MouseEvent,
	tab: TabInfo,
	ctx: TabContextMenuContext,
): void {
	const {
		tabs,
		onCloseTab,
		onCloseOtherTabs,
		onCloseTabsToRight,
		onRenameTab,
		onAiRenameTab,
		aiRenamingTabIds,
		getAiRenameAffordance,
	} = ctx;
	e.preventDefault();
	const menu = new Menu();
	registerOpenMenu(menu);

	menu.addItem((item: MenuItem) => {
		item.setTitle(t("chat.tabBar.rename"))
			.setIcon("pencil")
			.onClick(() => {
				onRenameTab(tab.tabId);
			});
	});

	if (onAiRenameTab) {
		const affordance: AiRenameAffordance =
			getAiRenameAffordance?.(tab.tabId) ??
			(aiRenamingTabIds?.has(tab.tabId)
				? { kind: "disabled", reason: "in-flight" }
				: { kind: "enabled" });
		menu.addItem((item: MenuItem) => {
			item.setTitle(aiRenameMenuTitle(affordance))
				.setIcon("sparkles")
				.setDisabled(affordance.kind === "disabled")
				.onClick(() => {
					onAiRenameTab(tab.tabId);
				});
		});
	}

	menu.addSeparator();

	// Close is always available — closing the last tab lands on the
	// zero-tab landing screen (reverses T06/T41/I23 for this path).
	menu.addItem((item: MenuItem) => {
		item.setTitle(t("chat.tabBar.close"))
			.setIcon("x")
			.onClick(() => {
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

		const tabIdx = tabs.findIndex((t) => t.tabId === tab.tabId);
		if (tabIdx < tabs.length - 1) {
			menu.addItem((item: MenuItem) => {
				item.setTitle(
					ctx.orientation === "vertical"
						? t("chat.tabBar.closeBelow")
						: t("chat.tabBar.closeToRight"),
				).onClick(() => {
					onCloseTabsToRight(tab.tabId);
				});
			});
		}
	}

	showMenuAtEvent(menu, e);
}

export interface TabListMenuContext {
	tabs: TabInfo[];
	activeTabId: string;
	onSelectTab: (tabId: string) => void;
}

/** The chevron (˅) tab list: every tab with its state icon. */
export function showTabListMenu(
	e: React.MouseEvent,
	{ tabs, activeTabId, onSelectTab }: TabListMenuContext,
): void {
	const menu = new Menu();
	// Native (OS) menus render plain-text titles and would drop the
	// state icon span below (I238, I278). Force a DOM menu so the list
	// matches the tab strip.
	menu.setUseNativeMenu(false);
	// I278: the icon lives in the title so it can carry the state
	// class (MenuItem has no setClass). Suppress the unused native slot.
	menu.setNoIcon();
	registerOpenMenu(menu);
	for (const tab of tabs) {
		// Tab Attention States: the active tab gets a bold label instead
		// of setChecked's checkmark, because a tick now means "finished
		// while you were away" and two ticks would read the same.
		const isActive = tab.tabId === activeTabId;
		const title = createFragment((f) => {
			const row = f.createSpan({
				cls: "agent-client-tab-list-title",
			});
			// aria-hidden: the row has no state label, and an
			// aria-label would pop a tooltip over the open menu.
			const icon = row.createSpan({
				cls: stateIconClass(tab.state),
			});
			icon.setAttribute("aria-hidden", "true");
			setIcon(icon, stateIcon(tab.state));
			if (isActive) {
				row.createEl("strong", { text: tab.label });
			} else {
				row.createSpan({ text: tab.label });
			}
		});
		menu.addItem((item: MenuItem) => {
			item.setTitle(title).onClick(() => {
				onSelectTab(tab.tabId);
			});
		});
	}
	showMenuAtEvent(menu, e);
}
