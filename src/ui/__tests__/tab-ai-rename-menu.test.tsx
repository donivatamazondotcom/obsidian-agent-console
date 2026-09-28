/**
 * F15 — "Rename with AI" in the tab's right-click menu ([[F15 Rename Tab With AI]]).
 * Pins the live TabBar wiring: menu item placement, click routing, the
 * in-flight disable, and the working indicator. Menu mock adapted from
 * tab-list-command.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import * as React from "react";

// Recorder shared with the hoisted obsidian mock.
const h = vi.hoisted(() => {
	interface FakeItem {
		title?: string;
		checked?: boolean;
		disabled?: boolean;
		click?: (e: unknown) => void;
	}
	const menus: Array<{
		items: FakeItem[];
		shown: boolean;
		via: string | null;
	}> = [];
	return { menus };
});

vi.mock("obsidian", () => {
	class Menu {
		items: Array<{
			title?: string;
			checked?: boolean;
			click?: (e: unknown) => void;
		}> = [];
		_record = {
			items: this.items,
			shown: false,
			via: null as string | null,
		};
		constructor() {
			h.menus.push(this._record);
		}
		addItem(cb: (item: unknown) => void) {
			const item: {
				title?: string;
				checked?: boolean;
				click?: (e: unknown) => void;
			} = {};
			const api = {
				setTitle(t: string) {
					item.title = t;
					return api;
				},
				setIcon() {
					return api;
				},
				setChecked(v: boolean) {
					item.checked = v;
					return api;
				},
				setDisabled(v: boolean) {
					(item as { disabled?: boolean }).disabled = v;
					return api;
				},
				onClick(fn: (e: unknown) => void) {
					item.click = fn;
					return api;
				},
			};
			cb(api);
			this.items.push(item);
			return this;
		}
		showAtMouseEvent() {
			this._record.shown = true;
			this._record.via = "mouse";
		}
		showAtPosition() {
			this._record.shown = true;
			this._record.via = "position";
		}
		onHide() {}
		addSeparator() {
			this.items.push({ title: "---" });
			return this;
		}
	}
	return { Menu, setIcon: vi.fn(), setTooltip: vi.fn() };
});

// Keep the real showMenuAtEvent so the chevron → helper → menu positioning
// runs end-to-end (the I115 keyboard-anchoring path is what we're verifying);
// only registerOpenMenu is stubbed.
vi.mock("../../utils/menu-registry", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../utils/menu-registry")>();
	return { ...actual, registerOpenMenu: vi.fn() };
});

import { TabBar, type TabBarProps } from "../TabBar";
import type { TabInfo } from "../../types/tab";

function tab(partial: Partial<TabInfo>): TabInfo {
	return {
		tabId: partial.tabId ?? "t1",
		agentId: partial.agentId ?? "kiro-cli",
		origin: "fresh",
		label: partial.label ?? "Tab",
		state: partial.state ?? "ready",
		createdAt: partial.createdAt ?? new Date(0),
	};
}

function baseProps(over: Partial<TabBarProps>): TabBarProps {
	return {
		tabs: [tab({ tabId: "t1", label: "A" })],
		activeTabId: "t1",
		onSelectTab: vi.fn(),
		onAddTab: vi.fn(),
		onCloseTab: vi.fn(),
		onCloseOtherTabs: vi.fn(),
		onCloseTabsToRight: vi.fn(),
		onRenameTab: vi.fn(),
		onMoveTab: vi.fn(),
		...over,
	};
}

beforeEach(() => {
	h.menus.length = 0;
});

function openTabMenu(container: HTMLElement, index = 0) {
	const tabs = container.querySelectorAll(".agent-client-tab");
	fireEvent.contextMenu(tabs[index]);
	return h.menus[h.menus.length - 1];
}

describe("F15 Rename with AI — tab context menu", () => {
	it("offers Rename with AI directly after Rename and routes the click", () => {
		const onAiRenameTab = vi.fn();
		const { container } = render(
			<TabBar {...baseProps({ onAiRenameTab })} />,
		);
		const menu = openTabMenu(container);
		const titles = menu.items.map((i) => i.title);
		expect(titles.slice(0, 2)).toEqual(["Rename", "Rename with AI"]);
		menu.items[1].click?.(new MouseEvent("click"));
		expect(onAiRenameTab).toHaveBeenCalledWith("t1");
	});

	it("disables the item and shows a working indicator while a rename runs", () => {
		const { container } = render(
			<TabBar
				{...baseProps({
					onAiRenameTab: vi.fn(),
					aiRenamingTabIds: new Set(["t1"]),
				})}
			/>,
		);
		const menu = openTabMenu(container);
		const item = menu.items.find((i) => i.title === "Rename with AI") as
			| { disabled?: boolean }
			| undefined;
		expect(item?.disabled).toBe(true);
		const indicator = container.querySelector(
			".agent-client-tab-ai-renaming",
		);
		expect(indicator?.getAttribute("role")).toBe("status");
		expect(indicator?.getAttribute("aria-label")).toBe("Renaming with AI…");
	});

	it("shows no indicator when idle", () => {
		const { container } = render(
			<TabBar {...baseProps({ onAiRenameTab: vi.fn() })} />,
		);
		expect(container.querySelector(".agent-client-tab-ai-renaming")).toBeNull();
	});
});
