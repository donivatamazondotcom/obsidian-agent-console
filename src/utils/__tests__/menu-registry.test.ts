import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	registerOpenMenu,
	closeOpenMenus,
	_openMenuCount,
	showMenuAtEvent,
} from "../menu-registry";
import type { Menu } from "obsidian";

/** Minimal Menu stub: records hide() and captures the onHide callback. */
function makeMenu() {
	let hideCb: (() => void) | undefined;
	const menu = {
		hide: vi.fn(() => {
			hideCb?.(); // Obsidian fires onHide when the menu hides
		}),
		onHide: vi.fn((cb: () => void) => {
			hideCb = cb;
		}),
	};
	return menu as unknown as Menu & {
		hide: ReturnType<typeof vi.fn>;
		onHide: ReturnType<typeof vi.fn>;
	};
}

describe("menu-registry (I14 — close orphaned menus on plugin unload)", () => {
	beforeEach(() => {
		// Ensure a clean registry between tests.
		closeOpenMenus();
	});

	it("tracks an open menu", () => {
		const m = makeMenu();
		registerOpenMenu(m);
		expect(_openMenuCount()).toBe(1);
		expect(m.onHide).toHaveBeenCalled();
	});

	it("auto-untracks a menu when it hides normally (selection / outside click)", () => {
		const m = makeMenu();
		registerOpenMenu(m);
		expect(_openMenuCount()).toBe(1);
		m.hide(); // user dismisses normally → onHide fires → untracked
		expect(_openMenuCount()).toBe(0);
	});

	it("closes every still-open menu on unload and clears the registry", () => {
		const a = makeMenu();
		const b = makeMenu();
		registerOpenMenu(a);
		registerOpenMenu(b);
		expect(_openMenuCount()).toBe(2);

		closeOpenMenus();

		expect(a.hide).toHaveBeenCalledTimes(1);
		expect(b.hide).toHaveBeenCalledTimes(1);
		expect(_openMenuCount()).toBe(0);
	});

	it("is idempotent — closing again with no open menus is a no-op", () => {
		closeOpenMenus();
		expect(_openMenuCount()).toBe(0);
	});
});

/** Menu stub recording the two positioning calls. */
function makePositionMenu() {
	return {
		showAtMouseEvent: vi.fn(),
		showAtPosition: vi.fn(),
	} as unknown as Menu & {
		showAtMouseEvent: ReturnType<typeof vi.fn>;
		showAtPosition: ReturnType<typeof vi.fn>;
	};
}

type TriggerEvent = Parameters<typeof showMenuAtEvent>[1];

function makeEvent(
	over: Partial<{ detail: number; clientX: number; clientY: number }>,
): TriggerEvent {
	const nativeEvent = { __native: true } as unknown as MouseEvent;
	return {
		detail: 1,
		clientX: 120,
		clientY: 40,
		currentTarget: {
			getBoundingClientRect: () => ({ left: 10, bottom: 25 }),
		},
		nativeEvent,
		...over,
	} as unknown as TriggerEvent;
}

describe("showMenuAtEvent (I115 — keyboard-activated menus anchor to the trigger)", () => {
	it("anchors to the button rect for keyboard activation (detail 0, no coords)", () => {
		const menu = makePositionMenu();
		showMenuAtEvent(menu, makeEvent({ detail: 0, clientX: 0, clientY: 0 }));
		expect(menu.showAtPosition).toHaveBeenCalledWith({ x: 10, y: 25 });
		expect(menu.showAtMouseEvent).not.toHaveBeenCalled();
	});

	it("anchors to the cursor for a real mouse click (detail >= 1)", () => {
		const menu = makePositionMenu();
		const e = makeEvent({ detail: 1, clientX: 120, clientY: 40 });
		showMenuAtEvent(menu, e);
		expect(menu.showAtMouseEvent).toHaveBeenCalledWith(e.nativeEvent);
		expect(menu.showAtPosition).not.toHaveBeenCalled();
	});

	it("anchors to the cursor for a right-click context menu (detail 0 but real coords)", () => {
		const menu = makePositionMenu();
		// Right-click contextmenu events carry detail 0 yet have genuine
		// coordinates — they must stay cursor-anchored, not rect-anchored.
		const e = makeEvent({ detail: 0, clientX: 200, clientY: 90 });
		showMenuAtEvent(menu, e);
		expect(menu.showAtMouseEvent).toHaveBeenCalledWith(e.nativeEvent);
		expect(menu.showAtPosition).not.toHaveBeenCalled();
	});
});
