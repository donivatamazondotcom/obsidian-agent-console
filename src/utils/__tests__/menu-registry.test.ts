import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	registerOpenMenu,
	closeOpenMenus,
	_openMenuCount,
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
