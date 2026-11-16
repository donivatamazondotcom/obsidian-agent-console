/**
 * Chat ID T46 — Copy link to chat in the tab right-click menu
 * ([[Agent Console Chat ID]] D11, D16).
 *
 * Pins the live wiring of both tab surfaces through the shared
 * `showTabContextMenu`: the item's position (Rename, Rename with AI, Copy
 * link to chat, separator, Close), that it routes the right-clicked tab while
 * another tab is active (strip, rail key and rail ×), and that it is absent
 * when the surface isn't given `onCopyChatLink`.
 *
 * Seams (R2): the real `TabBar`, `TabRail`, `showTabContextMenu` and
 * `showMenuAtEvent`. Only Obsidian's `Menu` is recorded (R4: the Obsidian
 * boundary). Assertions (R3): the menu's item titles in order and which tab
 * id the click hands to the callback. Literals (R5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";

const h = vi.hoisted(() => {
	interface Rec {
		titles: string[];
		clicks: Map<string, () => void>;
	}
	const menus: Rec[] = [];
	return { menus };
});

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	class Menu {
		rec = { titles: [] as string[], clicks: new Map<string, () => void>() };
		constructor() {
			h.menus.push(this.rec);
		}
		addItem(cb: (item: unknown) => void) {
			let title = "";
			const api = {
				setTitle: (t: string | DocumentFragment) => {
					title = typeof t === "string" ? t : (t.textContent ?? "");
					this.rec.titles.push(title);
					return api;
				},
				setIcon: () => api,
				setDisabled: () => api,
				setChecked: () => api,
				onClick: (fn: () => void) => {
					this.rec.clicks.set(title, fn);
					return api;
				},
			};
			cb(api);
			return this;
		}
		addSeparator() {
			this.rec.titles.push("---");
			return this;
		}
		setUseNativeMenu() {
			return this;
		}
		setNoIcon() {
			return this;
		}
		showAtMouseEvent() {}
		showAtPosition() {}
		onHide() {}
	}
	return { ...actual, Menu, setIcon: vi.fn(), setTooltip: vi.fn() };
});

vi.mock("../../utils/menu-registry", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../utils/menu-registry")>();
	return { ...actual, registerOpenMenu: vi.fn() };
});

vi.mock("../keyboard-focus", () => ({ isKeyboardFocus: () => true }));

import { TabBar, type TabBarProps } from "../TabBar";
import { TabRail, type RailSettingsStore } from "../TabRail";
import type { TabInfo } from "../../types/tab";

const COPY = "Copy link to chat";

function tab(id: string, label: string): TabInfo {
	return {
		tabId: id,
		agentId: "kiro-cli",
		origin: "fresh",
		label,
		state: "ready",
		createdAt: new Date(0),
	};
}

function props(over: Partial<TabBarProps> = {}): TabBarProps {
	return {
		tabs: [tab("t1", "Alpha"), tab("t2", "Beta"), tab("t3", "Gamma")],
		activeTabId: "t1",
		onSelectTab: vi.fn(),
		onAddTab: vi.fn(),
		onCloseTab: vi.fn(),
		onCloseOtherTabs: vi.fn(),
		onCloseTabsToRight: vi.fn(),
		onRenameTab: vi.fn(),
		onAiRenameTab: vi.fn(),
		onMoveTab: vi.fn(),
		...over,
	};
}

function fakeStore(): RailSettingsStore {
	const snap = { tabRailWidth: 160, tabRailNamedWidth: 160 };
	return {
		subscribe: () => () => {},
		getSnapshot: () => snap,
		updateSettings: () => Promise.resolve(),
	} as unknown as RailSettingsStore;
}

const lastMenu = () => h.menus[h.menus.length - 1];

beforeEach(() => {
	h.menus.length = 0;
	// A wide view, so the rail shows names and its × buttons.
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			const w = this.classList.contains("test-view") ? 1000 : 0;
			return {
				x: 0,
				y: 0,
				top: 0,
				left: 0,
				bottom: 0,
				right: w,
				width: w,
				height: 0,
				toJSON: () => ({}),
			} as DOMRect;
		},
	);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("Chat ID T46: Copy link to chat in the tab strip menu", () => {
	it("sits after Rename with AI, before the separator above Close", () => {
		const { container } = render(
			<TabBar {...props({ onCopyChatLink: vi.fn() })} />,
		);
		fireEvent.contextMenu(container.querySelectorAll(".agent-client-tab")[1]);
		expect(lastMenu().titles.slice(0, 5)).toEqual([
			"Rename",
			"Rename with AI",
			COPY,
			"---",
			"Close",
		]);
	});

	it("routes the right-clicked tab, not the active one", () => {
		const onCopyChatLink = vi.fn();
		const { container } = render(<TabBar {...props({ onCopyChatLink })} />);
		fireEvent.contextMenu(container.querySelectorAll(".agent-client-tab")[2]);
		lastMenu().clicks.get(COPY)?.();
		expect(onCopyChatLink).toHaveBeenCalledTimes(1);
		expect(onCopyChatLink).toHaveBeenCalledWith("t3");
	});

	it("is absent when the strip isn't given onCopyChatLink", () => {
		const { container } = render(<TabBar {...props()} />);
		fireEvent.contextMenu(container.querySelectorAll(".agent-client-tab")[0]);
		expect(lastMenu().titles).not.toContain(COPY);
	});
});

describe("Chat ID T46: Copy link to chat in the tab rail menu", () => {
	function renderRail(over: Partial<TabBarProps> = {}) {
		return render(
			<div className="test-view">
				<TabRail {...props(over)} settingsStore={fakeStore()} />
			</div>,
		);
	}
	const keys = (c: HTMLElement) =>
		c.querySelectorAll<HTMLElement>(".agent-client-tab-rail-key");
	const closes = (c: HTMLElement) =>
		c.querySelectorAll<HTMLElement>(".agent-client-tab-rail-close");

	it("from a key: after Rename with AI, and routes that key's tab", () => {
		const onCopyChatLink = vi.fn();
		const { container } = renderRail({ onCopyChatLink });
		fireEvent.contextMenu(keys(container)[1]);
		expect(lastMenu().titles.slice(0, 5)).toEqual([
			"Rename",
			"Rename with AI",
			COPY,
			"---",
			"Close",
		]);
		lastMenu().clicks.get(COPY)?.();
		expect(onCopyChatLink).toHaveBeenCalledWith("t2");
	});

	it("from a row's ×: routes that row's tab", () => {
		const onCopyChatLink = vi.fn();
		const { container } = renderRail({ onCopyChatLink });
		expect(closes(container).length).toBe(3);
		fireEvent.contextMenu(closes(container)[2]);
		lastMenu().clicks.get(COPY)?.();
		expect(onCopyChatLink).toHaveBeenCalledWith("t3");
	});

	it("is absent when the rail isn't given onCopyChatLink", () => {
		const { container } = renderRail();
		fireEvent.contextMenu(keys(container)[0]);
		expect(lastMenu().titles).not.toContain(COPY);
	});
});
