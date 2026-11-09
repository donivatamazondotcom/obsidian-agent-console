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
 *     viewport origin, and lists every tab with its state icon.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";

// Recorder shared with the hoisted obsidian mock.
const h = vi.hoisted(() => {
	interface FakeItem {
		title?: string;
		bold?: boolean;
		icon?: string;
		iconEl?: HTMLElement | null;
		checked?: boolean;
		click?: (e: unknown) => void;
	}
	const menus: Array<{
		items: FakeItem[];
		shown: boolean;
		via: string | null;
		native?: boolean;
		noIcon?: boolean;
	}> = [];
	// I278: shared so tests can see which element got which Lucide id.
	const setIcon = vi.fn();
	return { menus, setIcon };
});

vi.mock("obsidian", () => {
	class Menu {
		items: Array<{
			title?: string;
			bold?: boolean;
			icon?: string;
			iconEl?: HTMLElement | null;
			checked?: boolean;
			click?: (e: unknown) => void;
		}> = [];
		_record = {
			items: this.items,
			shown: false,
			via: null as string | null,
			native: undefined as boolean | undefined,
			noIcon: undefined as boolean | undefined,
		};
		constructor() {
			h.menus.push(this._record);
		}
		addItem(cb: (item: unknown) => void) {
			const item: {
				title?: string;
				bold?: boolean;
				icon?: string;
				iconEl?: HTMLElement | null;
				checked?: boolean;
				click?: (e: unknown) => void;
			} = {};
			const api = {
				setTitle(t: string | DocumentFragment) {
					item.title =
						typeof t === "string" ? t : (t.textContent ?? "");
					item.bold =
						typeof t !== "string" &&
						t.querySelector("strong") !== null;
					item.iconEl =
						typeof t === "string"
							? null
							: t.querySelector<HTMLElement>(
									".agent-client-tab-state-icon",
								);
					return api;
				},
				setIcon(i: string) {
					item.icon = i;
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
		setUseNativeMenu(v: boolean) {
			this._record.native = v;
			return this;
		}
		setNoIcon() {
			this._record.noIcon = true;
			return this;
		}
	}
	return { Menu, setIcon: h.setIcon, setTooltip: vi.fn() };
});

// Keep the real showMenuAtEvent so the chevron → helper → menu positioning
// runs end-to-end (the I115 keyboard-anchoring path is what we're verifying);
// only registerOpenMenu is stubbed.
vi.mock("../../utils/menu-registry", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../utils/menu-registry")>();
	return { ...actual, registerOpenMenu: vi.fn() };
});

import { TabBar, stateIcon, type TabBarProps } from "../TabBar";
import type { TabInfo, TabState } from "../../types/tab";

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

	it("invoking the opener pops the tab list anchored to the chevron (keyboard path), listing every tab with its state icon", () => {
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
		// Every tab listed by label. I278: the state icon lives in the title,
		// in a span with the strip's state class, so it gets the same color and
		// animation. The native icon slot is unused and suppressed.
		expect(menu.items.map((i) => i.title)).toEqual([
			"Done",
			"Working",
			"Waiting",
		]);
		expect(menu.items.every((i) => i.icon === undefined)).toBe(true);
		expect(menu.noIcon).toBe(true);
		expect(menu.items.map((i) => i.iconEl?.className)).toEqual([
			"agent-client-tab-state-icon agent-client-tab-state-ready",
			"agent-client-tab-state-icon agent-client-tab-state-busy",
			"agent-client-tab-state-icon agent-client-tab-state-permission",
		]);
		// Tab Attention States: the active tab is marked with a bold label, not
		// a checkmark, because a tick now means "finished while you were away".
		expect(menu.items.map((i) => i.bold ?? false)).toEqual([
			false,
			true,
			false,
		]);
		expect(menu.items.some((i) => i.checked)).toBe(false);
		// I238/I278: native (OS) menus render plain-text titles and would drop
		// the icon span, so the list forces a DOM menu.
		expect(menu.native).toBe(false);

		// Selecting an item routes through onSelectTab.
		menu.items[0].click?.(new MouseEvent("click"));
		expect(onSelectTab).toHaveBeenCalledWith("t1");
	});
	// I278: every state, not just the three above, gets its class and icon in
	// the dropdown, and the icon is hidden from screen readers (the row has no
	// state label, and an aria-label would pop a tooltip over the open menu).
	it("each dropdown row carries its state class, its Lucide icon, and aria-hidden", () => {
		const states: TabState[] = [
			"ready",
			"busy",
			"permission",
			"error",
			"disconnected",
			"released",
			"doneUnseen",
			"stoppedUnseen",
			"connecting",
			"failed",
		];
		let opener: (() => void) | undefined;
		render(
			<TabBar
				{...baseProps({
					onRegisterShowTabList: (fn) => {
						opener = fn;
					},
					tabs: states.map((s, i) =>
						tab({ tabId: `t${i}`, label: s, state: s }),
					),
					activeTabId: "t0",
				})}
			/>,
		);
		h.setIcon.mockClear();
		opener?.();
		const menu = h.menus[h.menus.length - 1];
		states.forEach((s, i) => {
			const el = menu.items[i].iconEl;
			expect(el?.className).toBe(
				`agent-client-tab-state-icon agent-client-tab-state-${s}`,
			);
			expect(el?.getAttribute("aria-hidden")).toBe("true");
			expect(h.setIcon).toHaveBeenCalledWith(el, stateIcon(s));
		});
	});

	// I278 review M3: the strip span's classes stay owned by React, so a state
	// change can't leave a stale class (a ready tab that keeps spinning).
	it("a strip state change leaves only the new state class", () => {
		const props = baseProps({
			tabs: [tab({ tabId: "t1", label: "A", state: "busy" })],
			activeTabId: "t1",
		});
		const { container, rerender } = render(<TabBar {...props} />);
		rerender(
			<TabBar
				{...props}
				tabs={[tab({ tabId: "t1", label: "A", state: "ready" })]}
			/>,
		);
		const el = container.querySelector(".agent-client-tab-state-icon");
		expect(el?.className).toBe(
			"agent-client-tab-state-icon agent-client-tab-state-ready",
		);
	});
});
