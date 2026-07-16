/**
 * Show tab list command — spec [[Agent Console Show Tab List Hotkey]].
 *
 * The chevron (`˅`) tab list is the one surface that shows every tab and its
 * status at once (a birds-eye view of "which session is done / needs me").
 * Until now it was mouse-only. The `show-tab-list` plugin command makes it
 * hotkey-bindable by opening that same list.
 *
 * These tests pin the live wiring, not a pure function:
 *   - TabBar registers an opener via `onRegisterShowTabList`.
 *   - Invoking that opener clicks the chevron, which routes through the real
 *     `showMenuAtEvent` helper. A programmatic `.click()` carries detail === 0
 *     / clientX,Y === 0 — the keyboard-activation signature — so the menu is
 *     anchored to the chevron rect (`showAtPosition`, the I115 fix), NOT the
 *     viewport origin, and lists every tab with its state glyph.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";

// Recorder shared with the hoisted obsidian mock.
const h = vi.hoisted(() => {
	interface FakeItem {
		title?: string;
		checked?: boolean;
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

describe("show-tab-list command wiring (TabBar.onRegisterShowTabList)", () => {
	it("registers an opener function on mount", () => {
		const onRegisterShowTabList = vi.fn();
		render(<TabBar {...baseProps({ onRegisterShowTabList })} />);
		expect(onRegisterShowTabList).toHaveBeenCalledTimes(1);
		expect(typeof onRegisterShowTabList.mock.calls[0][0]).toBe("function");
	});

	it("invoking the opener pops the tab list anchored to the chevron (keyboard path), listing every tab with its state glyph", () => {
		let opener: (() => void) | undefined;
		const onSelectTab = vi.fn();
		render(
			<TabBar
				{...baseProps({
					onSelectTab,
					onRegisterShowTabList: (fn) => {
						opener = fn;
					},
					tabs: [
						tab({ tabId: "t1", label: "Done", state: "ready" }),
						tab({ tabId: "t2", label: "Working", state: "busy" }),
						tab({
							tabId: "t3",
							label: "Waiting",
							state: "permission",
						}),
					],
					activeTabId: "t2",
				})}
			/>,
		);

		expect(opener).toBeTypeOf("function");
		opener?.();

		expect(h.menus).toHaveLength(1);
		const menu = h.menus[0];
		expect(menu.shown).toBe(true);
		// Command/keyboard activation → anchored to the chevron rect, not (0,0).
		expect(menu.via).toBe("position");
		// Every tab listed, each prefixed with its colorblind-safe state glyph.
		expect(menu.items.map((i) => i.title)).toEqual([
			"●  Done",
			"◐  Working",
			"△  Waiting",
		]);
		// Active tab is checked.
		expect(menu.items[1].checked).toBe(true);

		// Selecting an item routes through onSelectTab.
		menu.items[0].click?.(new MouseEvent("click"));
		expect(onSelectTab).toHaveBeenCalledWith("t1");
	});
});
