/**
 * Session tab strip keyboard navigation (TS-I08) — through the public
 * `TabBar` component, asserting DOM focus + callbacks (user-visible outcome).
 *
 * WAI-ARIA tabs pattern with MANUAL activation:
 *   - the strip is a `role="tablist"`;
 *   - roving tabindex: only the active tab is a Tab stop (tabIndex 0),
 *     the rest are -1, so Tab enters/leaves the strip in one stop;
 *   - Left/Right (wrapping) and Home/End move focus WITHOUT selecting —
 *     selecting a tab can start a session, so arrowing past tabs must not;
 *   - Enter/Space selects the focused tab.
 *
 * Reproduce-first: on `main` @ 4cadbd7 there is no tablist, every tab is
 * tabIndex 0, and arrow keys do nothing → red.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import * as React from "react";

vi.mock("obsidian", () => {
	class Menu {
		addItem() {
			return this;
		}
		addSeparator() {
			return this;
		}
		showAtMouseEvent() {}
		showAtPosition() {}
		onHide() {}
	}
	return { Menu, setIcon: vi.fn(), setTooltip: vi.fn() };
});

import { TabBar, type TabBarProps } from "../TabBar";
import type { TabInfo } from "../../types/tab";

function tab(tabId: string, label: string): TabInfo {
	return {
		tabId,
		agentId: "kiro-cli",
		origin: "fresh",
		label,
		state: "ready",
		createdAt: new Date(0),
	};
}

function setup(activeTabId = "t2") {
	const onSelectTab = vi.fn();
	const props: TabBarProps = {
		tabs: [tab("t1", "One"), tab("t2", "Two"), tab("t3", "Three")],
		activeTabId,
		onSelectTab,
		onAddTab: vi.fn(),
		onCloseTab: vi.fn(),
		onCloseOtherTabs: vi.fn(),
		onCloseTabsToRight: vi.fn(),
		onRenameTab: vi.fn(),
		onMoveTab: vi.fn(),
	};
	const utils = render(<TabBar {...props} />);
	const tabs = utils.getAllByRole("tab");
	return { ...utils, tabs, onSelectTab };
}

describe("tab strip keyboard navigation (TS-I08)", () => {
	afterEach(() => cleanup());

	it("groups the tabs in a tablist", () => {
		const { getByRole, tabs } = setup();
		const list = getByRole("tablist");
		for (const t of tabs) expect(list.contains(t)).toBe(true);
	});

	it("makes only the active tab a Tab stop (roving tabindex)", () => {
		const { tabs } = setup("t2");
		expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
	});

	it("ArrowRight / ArrowLeft move focus and wrap, without selecting", () => {
		const { tabs, onSelectTab } = setup("t2");
		tabs[1].focus();

		fireEvent.keyDown(tabs[1], { key: "ArrowRight" });
		expect(document.activeElement).toBe(tabs[2]);

		fireEvent.keyDown(tabs[2], { key: "ArrowRight" });
		expect(document.activeElement).toBe(tabs[0]);

		fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
		expect(document.activeElement).toBe(tabs[2]);

		expect(onSelectTab).not.toHaveBeenCalled();
	});

	it("Home / End jump to the first / last tab", () => {
		const { tabs } = setup("t2");
		tabs[1].focus();
		fireEvent.keyDown(tabs[1], { key: "End" });
		expect(document.activeElement).toBe(tabs[2]);
		fireEvent.keyDown(tabs[2], { key: "Home" });
		expect(document.activeElement).toBe(tabs[0]);
	});

	it("Enter on a focused tab selects that tab", () => {
		const { tabs, onSelectTab } = setup("t2");
		tabs[1].focus();
		fireEvent.keyDown(tabs[1], { key: "ArrowRight" });
		fireEvent.keyDown(tabs[2], { key: "Enter" });
		expect(onSelectTab).toHaveBeenCalledWith("t3");
	});

	it("arrow keys on the close button do not move tab focus", () => {
		const { tabs, getAllByRole } = setup("t2");
		const close = getAllByRole("button", { name: /close/i })[0];
		close.focus();
		fireEvent.keyDown(close, { key: "ArrowRight" });
		expect(document.activeElement).toBe(close);
		expect(tabs.includes(document.activeElement as HTMLElement)).toBe(false);
	});
});
