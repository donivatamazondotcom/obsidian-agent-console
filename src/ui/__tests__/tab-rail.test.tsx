/**
 * Vertical tab rail – component behavior ([[Agent Console Vertical Tab Rail]]).
 *
 * Drives the real TabRail through its public props and a fake settings store
 * (the same subscribe / getSnapshot / updateSettings surface as
 * plugin.settingsService). Obsidian's Menu is recorded; the real
 * showMenuAtEvent and tab-menus run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import * as React from "react";

const h = vi.hoisted(() => {
	const menus: Array<{ titles: string[]; shown: boolean }> = [];
	const setIcon = vi.fn();
	const keyboardFocus = { value: true };
	return { menus, setIcon, keyboardFocus };
});

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	class Menu {
		rec = { titles: [] as string[], shown: false };
		constructor() {
			h.menus.push(this.rec);
		}
		addItem(cb: (item: unknown) => void) {
			const api = {
				setTitle: (t: string | DocumentFragment) => {
					this.rec.titles.push(
						typeof t === "string" ? t : (t.textContent ?? ""),
					);
					return api;
				},
				setIcon: () => api,
				setDisabled: () => api,
				setChecked: () => api,
				onClick: () => api,
			};
			cb(api);
			return this;
		}
		addSeparator() {
			return this;
		}
		setUseNativeMenu() {
			return this;
		}
		setNoIcon() {
			return this;
		}
		showAtMouseEvent() {
			this.rec.shown = true;
		}
		showAtPosition() {
			this.rec.shown = true;
		}
		onHide() {}
	}
	return { ...actual, Menu, setIcon: h.setIcon, setTooltip: vi.fn() };
});

vi.mock("../../utils/menu-registry", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../utils/menu-registry")>();
	return { ...actual, registerOpenMenu: vi.fn() };
});

// jsdom's :focus-visible is a heuristic; the rail asks this helper instead.
vi.mock("../keyboard-focus", () => ({
	isKeyboardFocus: () => h.keyboardFocus.value,
}));

import { TabRail, type RailSettingsStore } from "../TabRail";
import { TabBar, stateIcon, stateIconClass, type TabBarProps } from "../TabBar";
import type { TabInfo, TabState } from "../../types/tab";

const STATES: TabState[] = [
	"ready",
	"busy",
	"permission",
	"error",
	"disconnected",
	"released",
	"doneUnseen",
	"stoppedUnseen",
	"connecting",
];

function tab(id: string, label: string, state: TabState = "ready"): TabInfo {
	return {
		tabId: id,
		agentId: "kiro-cli",
		origin: "fresh",
		label,
		state,
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
		onMoveTab: vi.fn(),
		...over,
	};
}

function fakeStore(init: { tabRailWidth: number; tabRailNamedWidth: number }) {
	let snap = { ...init };
	const listeners = new Set<() => void>();
	const store: RailSettingsStore & {
		updateSettings: ReturnType<typeof vi.fn>;
	} = {
		subscribe: (l: () => void) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		getSnapshot: () => snap,
		updateSettings: vi.fn((u: Partial<typeof snap>) => {
			snap = { ...snap, ...u };
			listeners.forEach((l) => l());
			return Promise.resolve();
		}),
	};
	return store;
}

let viewWidth = 1000;

function renderRail(
	p: Partial<TabBarProps> = {},
	stored = { tabRailWidth: 32, tabRailNamedWidth: 160 },
) {
	const store = fakeStore(stored);
	const utils = render(
		<div className="test-view">
			<TabRail {...props(p)} settingsStore={store} />
		</div>,
	);
	const rail = utils.container.querySelector<HTMLElement>(
		".agent-client-tab-rail",
	)!;
	const keys = () =>
		Array.from(
			utils.container.querySelectorAll<HTMLButtonElement>(
				".agent-client-tab-rail-key",
			),
		);
	const handle = utils.container.querySelector<HTMLElement>(
		".agent-client-tab-rail-handle",
	)!;
	const flyout = () =>
		utils.container.querySelector<HTMLElement>(
			".agent-client-tab-rail-flyout:not(.is-hidden)",
		);
	return { ...utils, store, rail, keys, handle, flyout };
}

beforeEach(() => {
	h.menus.length = 0;
	h.setIcon.mockClear();
	h.keyboardFocus.value = true;
	viewWidth = 1000;
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			const w = this.classList.contains("test-view") ? viewWidth : 0;
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
	// Unmount every rail (globals are off, so RTL doesn't auto-clean); a
	// mounted rail keeps its document-level Escape listener.
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("TabRail – status icons match the strip", () => {
	it("each key shows the same state icon as the strip, for all nine states", () => {
		const tabs = STATES.map((s, i) => tab(`t${i}`, s, s));
		const { keys } = renderRail({ tabs, activeTabId: "t0" });
		const strip = render(
			<TabBar {...props({ tabs, activeTabId: "t0" })} />,
		);
		const stripIcons = Array.from(
			strip.container.querySelectorAll(".agent-client-tab-state-icon"),
		).map((e) => e.className);
		const railIcons = keys().map(
			(k) => k.querySelector(".agent-client-tab-state-icon")?.className,
		);
		expect(railIcons).toEqual(stripIcons);
		STATES.forEach((s, i) => {
			const el = keys()[i].querySelector(".agent-client-tab-state-icon");
			expect(el?.className).toBe(stateIconClass(s));
			expect(h.setIcon).toHaveBeenCalledWith(el, stateIcon(s));
		});
	});
});

describe("TabRail – accessible names without tooltips", () => {
	it("no aria-label anywhere inside a key; the name is 'label, status'", () => {
		const { keys } = renderRail({
			tabs: [tab("t1", "Alpha", "busy"), tab("t2", "Beta")],
			aiRenamingTabIds: new Set(["t2"]),
		});
		for (const k of keys()) {
			expect(k.querySelectorAll("[aria-label]")).toHaveLength(0);
			expect(k.hasAttribute("aria-label")).toBe(false);
		}
		const name = (k: HTMLElement) =>
			document.getElementById(k.getAttribute("aria-labelledby")!)
				?.textContent;
		expect(name(keys()[0])).toBe("Alpha, Working");
		expect(name(keys()[1])).toBe("Beta, Ready, renaming with AI");
	});

	it("the key list carries no aria-label (no 'Tab list' tooltip over the rail); it is named by aria-labelledby", () => {
		const { container } = renderRail();
		const list = container.querySelector('[role="tablist"]')!;
		expect(list.hasAttribute("aria-label")).toBe(false);
		expect(
			document.getElementById(list.getAttribute("aria-labelledby")!)
				?.textContent,
		).toBe("Tab list");
	});

	it("keys are native buttons with role tab in a vertical tablist", () => {
		const { keys, container } = renderRail();
		expect(keys()[0].tagName).toBe("BUTTON");
		expect(keys()[0].getAttribute("role")).toBe("tab");
		expect(
			container
				.querySelector('[role="tablist"]')
				?.getAttribute("aria-orientation"),
		).toBe("vertical");
	});
});

describe("TabRail – icons vs names", () => {
	it("a stored named width shows names on the first render (no icon flash)", () => {
		const { container } = renderRail(
			{},
			{ tabRailWidth: 150, tabRailNamedWidth: 150 },
		);
		expect(
			container.querySelectorAll(".agent-client-tab-rail-key-label"),
		).toHaveLength(3);
		expect(
			container.querySelector(".agent-client-tab-rail.is-names"),
		).not.toBeNull();
	});
	it("icon-only shows no labels", () => {
		const { container } = renderRail();
		expect(
			container.querySelectorAll(".agent-client-tab-rail-key-label"),
		).toHaveLength(0);
	});
	it("a view too narrow for names shows icons without changing the stored width", () => {
		viewWidth = 200;
		const { container, store } = renderRail(
			{},
			{ tabRailWidth: 150, tabRailNamedWidth: 150 },
		);
		expect(
			container.querySelectorAll(".agent-client-tab-rail-key-label"),
		).toHaveLength(0);
		expect(store.updateSettings).not.toHaveBeenCalled();
	});
});

describe("TabRail – keyboard", () => {
	it("roving tabindex: only the active key is a Tab stop", () => {
		const { keys } = renderRail({ activeTabId: "t2" });
		expect(keys().map((k) => k.tabIndex)).toEqual([-1, 0, -1]);
	});
	it("ArrowDown / ArrowUp move focus and wrap; Home / End", () => {
		const { keys } = renderRail();
		keys()[0].focus();
		fireEvent.keyDown(keys()[0], { key: "ArrowDown" });
		expect(document.activeElement).toBe(keys()[1]);
		fireEvent.keyDown(keys()[1], { key: "ArrowUp" });
		fireEvent.keyDown(keys()[0], { key: "ArrowUp" });
		expect(document.activeElement).toBe(keys()[2]);
		fireEvent.keyDown(keys()[2], { key: "Home" });
		expect(document.activeElement).toBe(keys()[0]);
	});
	it("activating a key selects its tab", () => {
		const onSelectTab = vi.fn();
		const { keys } = renderRail({ onSelectTab });
		fireEvent.click(keys()[2]);
		expect(onSelectTab).toHaveBeenCalledWith("t3");
	});
});

describe("TabRail – flyout", () => {
	it("keyboard focus shows the flyout at once with name and status", () => {
		const { keys, flyout } = renderRail();
		act(() => keys()[1].focus());
		expect(flyout()?.textContent).toContain("Beta");
		expect(flyout()?.textContent).toContain("Ready");
		expect(flyout()?.getAttribute("aria-hidden")).toBe("true");
	});
	it("the focus flyout survives the list scrolling to the key", () => {
		const { keys, flyout, container } = renderRail();
		act(() => keys()[0].focus());
		fireEvent.keyDown(keys()[0], { key: "ArrowDown" });
		fireEvent.scroll(container.querySelector('[role="tablist"]')!);
		expect(flyout()?.textContent).toContain("Beta");
	});
	it("a mouse click on the active key never pins the flyout open", () => {
		h.keyboardFocus.value = false;
		const { keys, rail, flyout } = renderRail();
		fireEvent.pointerEnter(rail, { pointerType: "mouse" });
		act(() => keys()[0].focus());
		fireEvent.click(keys()[0]);
		fireEvent.pointerLeave(keys()[0], { pointerType: "mouse" });
		fireEvent.pointerLeave(rail, { pointerType: "mouse" });
		expect(flyout()).toBeNull();
	});
	it("first hover waits 250ms; the next key is instant", () => {
		vi.useFakeTimers();
		const { keys, rail, flyout } = renderRail();
		fireEvent.pointerEnter(rail, { pointerType: "mouse" });
		fireEvent.pointerEnter(keys()[0], { pointerType: "mouse" });
		expect(flyout()).toBeNull();
		act(() => {
			vi.advanceTimersByTime(250);
		});
		expect(flyout()?.textContent).toContain("Alpha");
		fireEvent.pointerLeave(keys()[0], { pointerType: "mouse" });
		fireEvent.pointerEnter(keys()[1], { pointerType: "mouse" });
		expect(flyout()?.textContent).toContain("Beta");
	});
	it("touch never opens a flyout", () => {
		vi.useFakeTimers();
		const { keys, flyout } = renderRail();
		fireEvent.pointerEnter(keys()[0], { pointerType: "touch" });
		act(() => {
			vi.advanceTimersByTime(500);
		});
		expect(flyout()).toBeNull();
	});
	it("Escape hides the flyout without blocking other Escape handlers", () => {
		const { keys, flyout } = renderRail();
		act(() => keys()[0].focus());
		const ev = new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			cancelable: true,
		});
		act(() => {
			document.dispatchEvent(ev);
		});
		expect(ev.defaultPrevented).toBe(false);
		expect(flyout()).toBeNull();
	});
});

describe("TabRail – resize handle", () => {
	it("is a focusable window splitter with value attributes", () => {
		const { handle } = renderRail();
		expect(handle.getAttribute("role")).toBe("separator");
		expect(handle.getAttribute("aria-orientation")).toBe("vertical");
		expect(handle.tabIndex).toBe(0);
		expect(handle.getAttribute("aria-valuenow")).toBe("32");
		expect(handle.getAttribute("aria-valuetext")).toBe("Icons only");
		expect(handle.hasAttribute("aria-label")).toBe(false);
	});

	it("a double-click toggles once and records the STORED width (stored 220, view 300)", () => {
		viewWidth = 300;
		const { handle, store } = renderRail(
			{},
			{ tabRailWidth: 220, tabRailNamedWidth: 160 },
		);
		for (let i = 0; i < 2; i++) {
			fireEvent.pointerDown(handle, {
				clientX: 500,
				button: 0,
				pointerId: 1,
				pointerType: "mouse",
			});
			fireEvent.pointerUp(handle, {
				clientX: 500,
				button: 0,
				pointerId: 1,
				pointerType: "mouse",
			});
		}
		fireEvent.doubleClick(handle);
		expect(store.updateSettings).toHaveBeenCalledTimes(1);
		expect(store.updateSettings).toHaveBeenCalledWith({
			tabRailWidth: 32,
			tabRailNamedWidth: 220,
		});
	});

	it("a press that moves under 3px writes nothing", () => {
		const { handle, store } = renderRail();
		fireEvent.pointerDown(handle, {
			clientX: 500,
			button: 0,
			pointerId: 1,
			pointerType: "mouse",
		});
		fireEvent.pointerMove(handle, {
			clientX: 498,
			pointerId: 1,
			pointerType: "mouse",
		});
		fireEvent.pointerUp(handle, {
			clientX: 498,
			pointerId: 1,
			pointerType: "mouse",
		});
		expect(store.updateSettings).not.toHaveBeenCalled();
	});

	it("a drag commits the resolved release width once, to both keys", () => {
		const { handle, store } = renderRail();
		fireEvent.pointerDown(handle, {
			clientX: 500,
			button: 0,
			pointerId: 1,
			pointerType: "mouse",
		});
		fireEvent.pointerMove(handle, {
			clientX: 380,
			pointerId: 1,
			pointerType: "mouse",
		});
		fireEvent.pointerUp(handle, {
			clientX: 380,
			pointerId: 1,
			pointerType: "mouse",
		});
		expect(store.updateSettings).toHaveBeenCalledTimes(1);
		expect(store.updateSettings).toHaveBeenCalledWith({
			tabRailWidth: 152,
			tabRailNamedWidth: 152,
		});
	});

	it("a drag released below the snap point goes to icons and keeps the named width", () => {
		const { handle, store } = renderRail(
			{},
			{ tabRailWidth: 150, tabRailNamedWidth: 150 },
		);
		fireEvent.pointerDown(handle, {
			clientX: 500,
			button: 0,
			pointerId: 1,
			pointerType: "mouse",
		});
		fireEvent.pointerMove(handle, {
			clientX: 620,
			pointerId: 1,
			pointerType: "mouse",
		});
		fireEvent.pointerUp(handle, {
			clientX: 620,
			pointerId: 1,
			pointerType: "mouse",
		});
		expect(store.updateSettings).toHaveBeenCalledWith({
			tabRailWidth: 32,
			tabRailNamedWidth: 150,
		});
	});

	it("pointercancel and Escape revert a drag without writing", () => {
		const { handle, store } = renderRail();
		fireEvent.pointerDown(handle, {
			clientX: 500,
			button: 0,
			pointerId: 1,
			pointerType: "mouse",
		});
		fireEvent.pointerMove(handle, {
			clientX: 380,
			pointerId: 1,
			pointerType: "mouse",
		});
		fireEvent.pointerCancel(handle, { pointerId: 1, pointerType: "mouse" });
		fireEvent.pointerDown(handle, {
			clientX: 500,
			button: 0,
			pointerId: 1,
			pointerType: "mouse",
		});
		fireEvent.pointerMove(handle, {
			clientX: 380,
			pointerId: 1,
			pointerType: "mouse",
		});
		fireEvent.keyDown(document, { key: "Escape" });
		fireEvent.pointerUp(handle, {
			clientX: 380,
			pointerId: 1,
			pointerType: "mouse",
		});
		expect(store.updateSettings).not.toHaveBeenCalled();
	});

	it("arrow keys resize at once and write once after 300ms", () => {
		vi.useFakeTimers();
		const { handle, store, container } = renderRail();
		fireEvent.keyDown(handle, { key: "ArrowLeft" });
		expect(handle.getAttribute("aria-valuenow")).toBe("60");
		expect(
			container.querySelector(".agent-client-tab-rail.is-names"),
		).not.toBeNull();
		fireEvent.keyDown(handle, { key: "ArrowLeft" });
		expect(store.updateSettings).not.toHaveBeenCalled();
		act(() => {
			vi.advanceTimersByTime(300);
		});
		expect(store.updateSettings).toHaveBeenCalledTimes(1);
		expect(store.updateSettings).toHaveBeenCalledWith({
			tabRailWidth: 70,
			tabRailNamedWidth: 70,
		});
	});

	it("a pending keyboard resize is written on unmount", () => {
		vi.useFakeTimers();
		const { handle, store, unmount } = renderRail();
		fireEvent.keyDown(handle, { key: "ArrowLeft" });
		unmount();
		expect(store.updateSettings).toHaveBeenCalledWith({
			tabRailWidth: 60,
			tabRailNamedWidth: 60,
		});
	});

	it("Enter on the handle toggles", () => {
		const { handle, store } = renderRail(
			{},
			{ tabRailWidth: 32, tabRailNamedWidth: 180 },
		);
		fireEvent.keyDown(handle, { key: "Enter" });
		expect(store.updateSettings).toHaveBeenCalledWith({
			tabRailWidth: 180,
			tabRailNamedWidth: 180,
		});
	});
});

describe("TabRail – review findings", () => {
	// Run drag frames synchronously so the per-frame preview is deterministic.
	const syncFrames = () =>
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
			act(() => cb(0));
			return 1;
		});

	it("a primary press on the handle doesn't move focus or start a text selection", () => {
		const { handle } = renderRail();
		const md = new MouseEvent("mousedown", {
			button: 0,
			bubbles: true,
			cancelable: true,
		});
		handle.dispatchEvent(md);
		expect(md.defaultPrevented).toBe(true);
	});

	it("a drag that crosses into names and back commits icons and keeps the named width", () => {
		syncFrames();
		const { handle, store, container } = renderRail(
			{},
			{ tabRailWidth: 32, tabRailNamedWidth: 170 },
		);
		fireEvent.pointerDown(handle, {
			clientX: 500,
			button: 0,
			pointerId: 1,
			pointerType: "mouse",
		});
		fireEvent.pointerMove(handle, {
			clientX: 400,
			pointerId: 1,
			pointerType: "mouse",
		});
		expect(
			container.querySelector(".agent-client-tab-rail.is-names"),
		).not.toBeNull();
		fireEvent.pointerMove(handle, {
			clientX: 495,
			pointerId: 1,
			pointerType: "mouse",
		});
		expect(
			container.querySelector(".agent-client-tab-rail.is-icons"),
		).not.toBeNull();
		fireEvent.pointerUp(handle, {
			clientX: 495,
			pointerId: 1,
			pointerType: "mouse",
		});
		expect(store.updateSettings).toHaveBeenCalledWith({
			tabRailWidth: 32,
			tabRailNamedWidth: 170,
		});
	});

	it("a drag into names that is reverted goes back to icons with no write", () => {
		syncFrames();
		const { handle, store, container } = renderRail();
		fireEvent.pointerDown(handle, {
			clientX: 500,
			button: 0,
			pointerId: 1,
			pointerType: "mouse",
		});
		fireEvent.pointerMove(handle, {
			clientX: 380,
			pointerId: 1,
			pointerType: "mouse",
		});
		expect(
			container.querySelector(".agent-client-tab-rail.is-names"),
		).not.toBeNull();
		fireEvent(handle, new Event("lostpointercapture", { bubbles: true }));
		expect(
			container.querySelector(".agent-client-tab-rail.is-icons"),
		).not.toBeNull();
		expect(store.updateSettings).not.toHaveBeenCalled();
	});

	it("right-clicking a key opens no flyout and hides one that was showing", () => {
		vi.useFakeTimers();
		const { keys, rail, flyout } = renderRail();
		fireEvent.pointerEnter(rail, { pointerType: "mouse" });
		fireEvent.pointerEnter(keys()[0], { pointerType: "mouse" });
		act(() => {
			vi.advanceTimersByTime(250);
		});
		expect(flyout()).not.toBeNull();
		fireEvent.contextMenu(keys()[0]);
		expect(flyout()).toBeNull();
	});

	it("closing the tab whose flyout is showing leaves no flyout", () => {
		vi.useFakeTimers();
		const p = props();
		const store = fakeStore({ tabRailWidth: 32, tabRailNamedWidth: 160 });
		const { container, rerender } = render(
			<div className="test-view">
				<TabRail {...p} settingsStore={store} />
			</div>,
		);
		const key = () =>
			container.querySelectorAll<HTMLElement>(
				".agent-client-tab-rail-key",
			);
		fireEvent.pointerEnter(
			container.querySelector(".agent-client-tab-rail")!,
			{ pointerType: "mouse" },
		);
		fireEvent.pointerEnter(key()[1], { pointerType: "mouse" });
		act(() => {
			vi.advanceTimersByTime(250);
		});
		// Precondition: the closing tab's flyout is showing.
		expect(
			container.querySelector(
				".agent-client-tab-rail-flyout:not(.is-hidden)",
			)?.textContent,
		).toContain("Beta");
		rerender(
			<div className="test-view">
				<TabRail
					{...p}
					tabs={p.tabs.filter((t) => t.tabId !== "t2")}
					settingsStore={store}
				/>
			</div>,
		);
		expect(
			container.querySelector(
				".agent-client-tab-rail-flyout:not(.is-hidden)",
			),
		).toBeNull();
	});

	it("a pen hover opens the flyout like a mouse", () => {
		vi.useFakeTimers();
		const { keys, flyout } = renderRail();
		fireEvent.pointerEnter(keys()[0], { pointerType: "pen" });
		act(() => {
			vi.advanceTimersByTime(250);
		});
		expect(flyout()?.textContent).toContain("Alpha");
	});
});

describe("TabRail – delta review findings", () => {
	it("a drag frame is requested and cancelled on the handle's own window (popouts)", () => {
		const { handle } = renderRail();
		// Build the events first: fireEvent constructs them from the document's
		// defaultView, which the popout stub below replaces.
		const down = new PointerEvent("pointerdown", {
			clientX: 500,
			button: 0,
			pointerId: 1,
			pointerType: "mouse",
			bubbles: true,
		});
		const move = new PointerEvent("pointermove", {
			clientX: 400,
			pointerId: 1,
			pointerType: "mouse",
			bubbles: true,
		});
		const cancelEv = new PointerEvent("pointercancel", {
			pointerId: 1,
			pointerType: "mouse",
			bubbles: true,
		});
		// A popout: the handle's document belongs to a different window.
		const popout = {
			requestAnimationFrame: vi.fn(() => 42),
			cancelAnimationFrame: vi.fn(),
		};
		// Restore exactly what was there: under vitest's jsdom the document's
		// defaultView is an own property, and deleting it would leave later
		// tests on jsdom's inner window instead of the test `window` (I301).
		const ownView = Object.getOwnPropertyDescriptor(
			handle.ownerDocument,
			"defaultView",
		);
		Object.defineProperty(handle.ownerDocument, "defaultView", {
			configurable: true,
			get: () => popout,
		});
		const mainReq = vi.spyOn(window, "requestAnimationFrame");
		const mainCancel = vi.spyOn(window, "cancelAnimationFrame");
		try {
			act(() => {
				handle.dispatchEvent(down);
				handle.dispatchEvent(move);
			});
			expect(popout.requestAnimationFrame).toHaveBeenCalledTimes(1);
			act(() => {
				handle.dispatchEvent(cancelEv);
			});
			expect(popout.cancelAnimationFrame).toHaveBeenCalledWith(42);
			expect(mainReq).not.toHaveBeenCalled();
			expect(mainCancel).not.toHaveBeenCalled();
		} finally {
			if (ownView) {
				Object.defineProperty(handle.ownerDocument, "defaultView", ownView);
			} else {
				delete (
					handle.ownerDocument as unknown as { defaultView?: unknown }
				).defaultView;
			}
		}
	});

	it("a view resize that only changes height scrolls the active key back into view", () => {
		let observerCb: (() => void) | null = null;
		class RO {
			constructor(cb: () => void) {
				observerCb = cb;
			}
			observe() {}
			disconnect() {}
		}
		vi.stubGlobal("ResizeObserver", RO);
		try {
			const tabs = Array.from({ length: 12 }, (_, i) =>
				tab(`t${i}`, `Tab ${i}`),
			);
			const { container } = renderRail({ tabs, activeTabId: "t11" });
			const list = container.querySelector<HTMLElement>(
				".agent-client-tab-rail-list",
			)!;
			const active = container.querySelector<HTMLElement>(
				".agent-client-tab-rail-key.is-active",
			)!;
			// The list shrinks to 100px tall; the active key now sits below it.
			vi.spyOn(list, "getBoundingClientRect").mockReturnValue({
				top: 0,
				bottom: 100,
				left: 0,
				right: 32,
				width: 32,
				height: 100,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			} as DOMRect);
			vi.spyOn(active, "getBoundingClientRect").mockReturnValue({
				top: 300,
				bottom: 328,
				left: 0,
				right: 32,
				width: 32,
				height: 28,
				x: 0,
				y: 300,
				toJSON: () => ({}),
			} as DOMRect);
			list.scrollTop = 0;
			act(() => observerCb?.());
			expect(list.scrollTop).toBe(228);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("TabRail – shared tab actions", () => {
	it("right-click a key opens the shared context menu with 'Close below'", () => {
		const { keys } = renderRail();
		fireEvent.contextMenu(keys()[0]);
		const menu = h.menus[h.menus.length - 1];
		expect(menu.shown).toBe(true);
		expect(menu.titles).toContain("Rename");
		expect(menu.titles).toContain("Close below");
		expect(menu.titles).not.toContain("Close to the right");
	});
	it("middle-click closes the tab", () => {
		const onCloseTab = vi.fn();
		const { keys } = renderRail({ onCloseTab });
		fireEvent.mouseDown(keys()[1], { button: 1 });
		expect(onCloseTab).toHaveBeenCalledWith("t2");
	});
	it("registers the tab list for the show-tab-list command", () => {
		let opener: (() => void) | undefined;
		renderRail({
			onRegisterShowTabList: (fn) => {
				opener = fn;
			},
		});
		opener?.();
		const menu = h.menus[h.menus.length - 1];
		expect(menu.titles).toEqual(["Alpha", "Beta", "Gamma"]);
	});
	it("+ adds a tab", () => {
		const onAddTab = vi.fn();
		const { container } = renderRail({ onAddTab });
		fireEvent.click(
			container.querySelector(
				".agent-client-tab-rail .agent-client-tab-bar-add",
			)!,
		);
		expect(onAddTab).toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// I301: close button on named rail keys (100 px and wider, hover-only, an
// overlay at the row's trailing edge) and Delete/Backspace on a focused key.
// jsdom loads no CSS, so these pin structure, events and focus; visibility at
// rest vs hover, the fade, label width and the active fill on hover are
// smoke-only.
// ---------------------------------------------------------------------------
describe("TabRail – close button and Delete (I301)", () => {
	const NAMED = { tabRailWidth: 160, tabRailNamedWidth: 160 };
	const closes = (c: HTMLElement) =>
		Array.from(
			c.querySelectorAll<HTMLButtonElement>(".agent-client-tab-rail-close"),
		);
	const syncFrames = () =>
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
			act(() => cb(0));
			return 1;
		});
	const eightTabs = () =>
		Array.from({ length: 8 }, (_, i) => tab(`t${i + 1}`, `Tab ${i + 1}`));

	/** A rail whose parent owns the tab list, like ChatView + useTabManager. */
	function Harness({
		init,
		active,
		onClose,
		stored,
	}: {
		init: TabInfo[];
		active: string;
		onClose: (id: string) => void;
		stored: { tabRailWidth: number; tabRailNamedWidth: number };
	}) {
		const [state, setState] = React.useState({ tabs: init, active });
		const store = React.useMemo(() => fakeStore(stored), [stored]);
		return (
			<div className="test-view">
				<TabRail
					{...props({
						tabs: state.tabs,
						activeTabId: state.active,
						onCloseTab: (id) => {
							onClose(id);
							setState((s) => {
								const i = s.tabs.findIndex((t) => t.tabId === id);
								const next = s.tabs.filter((t) => t.tabId !== id);
								const nextActive =
									id === s.active
										? (next[Math.min(i, next.length - 1)]?.tabId ?? "")
										: s.active;
								return { tabs: next, active: nextActive };
							});
						},
					})}
					settingsStore={store}
				/>
			</div>
		);
	}
	function renderHarness(
		init: TabInfo[],
		active: string,
		stored = NAMED,
	) {
		const onClose = vi.fn();
		const utils = render(
			<Harness init={init} active={active} onClose={onClose} stored={stored} />,
		);
		const keys = () =>
			Array.from(
				utils.container.querySelectorAll<HTMLButtonElement>(
					".agent-client-tab-rail-key",
				),
			);
		return { ...utils, onClose, keys };
	}

	// Test 3 – structure, click, middle-click, right-click.
	it("a named rail at 160 has one aria-hidden, untabbable × per row, a sibling of the key", () => {
		const { container, keys } = renderRail({}, NAMED);
		const xs = closes(container);
		expect(xs).toHaveLength(3);
		xs.forEach((x, i) => {
			expect(x.tagName).toBe("BUTTON");
			expect(x.classList.contains("clickable-icon")).toBe(true);
			expect(x.getAttribute("aria-hidden")).toBe("true");
			expect(x.tabIndex).toBe(-1);
			const row = x.parentElement!;
			expect(row.classList.contains("agent-client-tab-rail-row")).toBe(true);
			expect(row.getAttribute("role")).toBe("presentation");
			expect(keys()[i].parentElement).toBe(row);
			expect(keys()[i].contains(x)).toBe(false);
		});
		expect(h.setIcon).toHaveBeenCalledWith(xs[0], "x");
	});

	it("a click on × closes that tab once and selects nothing", () => {
		const onCloseTab = vi.fn();
		const onSelectTab = vi.fn();
		const { container } = renderRail({ onCloseTab, onSelectTab }, NAMED);
		fireEvent.click(closes(container)[1]);
		expect(onCloseTab).toHaveBeenCalledTimes(1);
		expect(onCloseTab).toHaveBeenCalledWith("t2");
		expect(onSelectTab).not.toHaveBeenCalled();
	});

	it("middle-click on × closes the tab", () => {
		const onCloseTab = vi.fn();
		const { container } = renderRail({ onCloseTab }, NAMED);
		fireEvent.mouseDown(closes(container)[2], { button: 1 });
		expect(onCloseTab).toHaveBeenCalledWith("t3");
	});

	it("right-click on × opens the shared context menu, like the key", () => {
		const { container } = renderRail({}, NAMED);
		fireEvent.contextMenu(closes(container)[0]);
		const menu = h.menus[h.menus.length - 1];
		expect(menu.shown).toBe(true);
		expect(menu.titles).toContain("Close below");
	});

	// Test 4 – no × where it doesn't fit.
	it("no × in icon-only mode or at 90 px", () => {
		expect(closes(renderRail().container)).toHaveLength(0);
		cleanup();
		const at90 = renderRail({}, { tabRailWidth: 90, tabRailNamedWidth: 90 });
		expect(at90.container.querySelector(".is-names")).not.toBeNull();
		expect(closes(at90.container)).toHaveLength(0);
	});

	it("the scrollbar gutter is reserved only in names mode (icons stay centered)", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const css = fs.readFileSync(path.resolve(__dirname, "../../../styles.css"), "utf8");
		const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) =>
			/scrollbar-gutter\s*:\s*stable/.test(m[2]),
		);
		expect(rules.length).toBeGreaterThan(0);
		for (const m of rules) {
			expect(m[1]).toContain(".agent-client-tab-rail.is-names");
			expect(m[1]).toContain(".agent-client-tab-rail-list");
		}
	});

	// Test 5 – accessibility.
	it("no aria-label anywhere inside the tablist, with an AI rename in flight", () => {
		const { container } = renderRail(
			{ aiRenamingTabIds: new Set(["t2"]) },
			NAMED,
		);
		const list = container.querySelector('[role="tablist"]')!;
		expect(list.querySelectorAll("[aria-label]")).toHaveLength(0);
	});

	it("the list has one Tab stop, and arrow keys never land on a ×", () => {
		const { container, keys } = renderRail({}, NAMED);
		const list = container.querySelector('[role="tablist"]')!;
		const stops = Array.from(list.querySelectorAll<HTMLElement>("button")).filter(
			(b) => b.tabIndex === 0,
		);
		expect(stops).toEqual([keys()[0]]);
		keys()[0].focus();
		for (let i = 0; i < 7; i++) {
			fireEvent.keyDown(document.activeElement!, { key: i % 2 ? "End" : "ArrowDown" });
			expect(document.activeElement?.getAttribute("role")).toBe("tab");
		}
	});

	// Test 6 – focus.
	it("a left press on × doesn't take focus (the composer keeps it)", () => {
		const { container } = renderRail({}, NAMED);
		const md = new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true });
		closes(container)[1].dispatchEvent(md);
		expect(md.defaultPrevented).toBe(true);
	});

	it("Delete on a focused inactive key closes it and focuses the key now at its index, not the active tab", () => {
		const { keys, onClose } = renderHarness(eightTabs(), "t1");
		keys()[5].focus();
		fireEvent.keyDown(keys()[5], { key: "Delete" });
		expect(onClose).toHaveBeenCalledWith("t6");
		expect(keys()).toHaveLength(7);
		expect(document.activeElement).toBe(keys()[5]);
		expect(keys()[5].dataset.tabId).toBe("t7");
	});

	it("Delete on the focused active key focuses the new active neighbor", () => {
		const { keys } = renderHarness(eightTabs(), "t3");
		keys()[2].focus();
		fireEvent.keyDown(keys()[2], { key: "Delete" });
		expect(document.activeElement).toBe(keys()[2]);
		expect(keys()[2].dataset.tabId).toBe("t4");
		expect(keys()[2].getAttribute("aria-selected")).toBe("true");
	});

	it("Delete on the last key focuses the new last key", () => {
		const { keys } = renderHarness(eightTabs(), "t1");
		keys()[7].focus();
		fireEvent.keyDown(keys()[7], { key: "Backspace" });
		expect(keys()).toHaveLength(7);
		expect(document.activeElement).toBe(keys()[6]);
	});

	it("held (repeated) and modified Delete close nothing more", () => {
		const { keys, onClose } = renderHarness(eightTabs(), "t1");
		keys()[3].focus();
		fireEvent.keyDown(keys()[3], { key: "Delete" });
		fireEvent.keyDown(document.activeElement!, { key: "Delete", repeat: true });
		fireEvent.keyDown(document.activeElement!, { key: "Delete", repeat: true });
		fireEvent.keyDown(document.activeElement!, { key: "Delete", metaKey: true });
		fireEvent.keyDown(document.activeElement!, { key: "Backspace", altKey: true });
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(keys()).toHaveLength(7);
	});

	it("Delete works in icon-only mode", () => {
		const { keys, onClose } = renderHarness(eightTabs(), "t1", {
			tabRailWidth: 32,
			tabRailNamedWidth: 160,
		});
		keys()[1].focus();
		fireEvent.keyDown(keys()[1], { key: "Delete" });
		expect(onClose).toHaveBeenCalledWith("t2");
	});

	// Test 10 – the close path reads the current tabs, not a stale list.
	it("after a same-length reorder, Delete closes the tab now at that index", () => {
		const onCloseTab = vi.fn();
		const p = props({ onCloseTab });
		const store = fakeStore(NAMED);
		const { container, rerender } = render(
			<div className="test-view">
				<TabRail {...p} settingsStore={store} />
			</div>,
		);
		rerender(
			<div className="test-view">
				<TabRail {...p} tabs={[...p.tabs].reverse()} settingsStore={store} />
			</div>,
		);
		const k0 = container.querySelectorAll<HTMLElement>(".agent-client-tab-rail-key")[0];
		k0.focus();
		fireEvent.keyDown(k0, { key: "Delete" });
		expect(onCloseTab).toHaveBeenCalledWith("t3");
	});

	// Test 7 – drag across 100 px, and the render-count bar.
	function dragCommits(moves: number[]) {
		const frames = syncFrames();
		let commits = 0;
		const store = fakeStore(NAMED);
		const utils = render(
			<div className="test-view">
				<React.Profiler id="rail" onRender={() => commits++}>
					<TabRail {...props()} settingsStore={store} />
				</React.Profiler>
			</div>,
		);
		const handle = utils.container.querySelector<HTMLElement>(
			".agent-client-tab-rail-handle",
		)!;
		const seen: number[] = [];
		const before = commits;
		fireEvent.pointerDown(handle, { clientX: 500, button: 0, pointerId: 1, pointerType: "mouse" });
		for (const x of moves) {
			fireEvent.pointerMove(handle, { clientX: x, pointerId: 1, pointerType: "mouse" });
			seen.push(closes(utils.container).length);
		}
		const during = commits - before;
		cleanup();
		frames.mockRestore();
		return { during, seen };
	}

	it("dragging 160 → 90 hides the × during the drag; back to 120 shows it", () => {
		const { seen } = dragCommits([570, 540]);
		expect(seen).toEqual([0, 3]);
	});

	it("render count: a 100 px crossing costs one rail render each; a mode + × flip costs one", () => {
		const base = dragCommits([460]).during; // 160 → 200: no flip
		const twoCrossings = dragCommits([570, 540]).during; // 160 → 90 → 120
		const bothFlip = dragCommits([620]).during; // 160 → 40: icons and no × together
		expect(twoCrossings - base).toBe(2);
		expect(bothFlip - base).toBe(1);
	});

	// Test 8 – key and × are one hover target.
	function cutLabels(scroll: number, client: number) {
		vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
			return this.classList.contains("agent-client-tab-rail-key-label") ? scroll : 0;
		});
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
			return this.classList.contains("agent-client-tab-rail-key-label") ? client : 0;
		});
	}

	it("moving the pointer from a key onto its × keeps the flyout", () => {
		vi.useFakeTimers();
		cutLabels(200, 100);
		const { container, keys, rail, flyout } = renderRail({}, NAMED);
		fireEvent.pointerEnter(rail, { pointerType: "mouse" });
		fireEvent.pointerEnter(keys()[1], { pointerType: "mouse" });
		act(() => {
			vi.advanceTimersByTime(250);
		});
		expect(flyout()?.textContent).toContain("Beta");
		const x = closes(container)[1];
		fireEvent.pointerOut(keys()[1], { pointerType: "mouse", relatedTarget: x });
		fireEvent.pointerOver(x, { pointerType: "mouse", relatedTarget: keys()[1] });
		expect(flyout()?.textContent).toContain("Beta");
	});

	it("closing via × leaves no flyout on the closed key", () => {
		vi.useFakeTimers();
		cutLabels(200, 100);
		const { container, keys } = renderHarness(eightTabs(), "t1");
		fireEvent.pointerEnter(container.querySelector(".agent-client-tab-rail")!, { pointerType: "mouse" });
		fireEvent.pointerEnter(keys()[2], { pointerType: "mouse" });
		act(() => {
			vi.advanceTimersByTime(250);
		});
		const shown = () =>
			container.querySelector(".agent-client-tab-rail-flyout:not(.is-hidden)");
		expect(shown()?.textContent).toContain("Tab 3");
		fireEvent.click(closes(container)[2]);
		expect(shown()).toBeNull();
	});

	// Test 9, component side – the overlay counts only for a pointer flyout.
	it("a name that fits but ends under the × shows its flyout on hover, not on keyboard focus", () => {
		vi.useFakeTimers();
		cutLabels(80, 100);
		const { keys, rail, flyout } = renderRail({}, NAMED);
		fireEvent.pointerEnter(rail, { pointerType: "mouse" });
		fireEvent.pointerEnter(keys()[1], { pointerType: "mouse" });
		act(() => {
			vi.advanceTimersByTime(250);
		});
		expect(flyout()?.textContent).toContain("Beta");
		fireEvent.pointerLeave(keys()[1], { pointerType: "mouse" });
		fireEvent.pointerLeave(rail, { pointerType: "mouse" });
		act(() => {
			vi.advanceTimersByTime(400);
		});
		fireEvent.focus(keys()[2]);
		expect(flyout()).toBeNull();
	});
});
