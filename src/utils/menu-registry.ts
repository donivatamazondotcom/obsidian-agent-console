import type { Menu } from "obsidian";

/**
 * Tracks currently-open Obsidian {@link Menu} popups so the plugin can close
 * them when it unloads.
 *
 * Obsidian's `Menu` is a native popup that is NOT closed automatically when the
 * owning plugin unloads. If the plugin is reloaded (a BRAT update, a manual
 * disable/enable, or the screenshot-automation `setup.sh`) while a dropdown
 * menu is open, the menu *orphans*: it stays on screen, detached from the
 * unloaded plugin's menu manager, and a newly-opened menu will not replace it.
 * For real users this is a minor cosmetic glitch (a stray menu, dismissable
 * with a click); for the screenshot pipeline it means a later capture
 * screenshots the prior run's menu (I14 in the screenshot-automation spec).
 *
 * Registering each menu on open and closing any still-open ones in the plugin's
 * `onunload` prevents the orphan. The registry is module-level (shared across
 * the plugin's components); the plugin instance owns the lifecycle by calling
 * {@link closeOpenMenus} from `onunload`, which runs while this module's state
 * is still intact (the module only reloads on the subsequent enable).
 */
const openMenus = new Set<Menu>();

/**
 * Track a freshly-created menu so it can be force-closed on plugin unload.
 * The menu auto-untracks itself when it hides normally (selection or outside
 * click), so the registry only ever holds genuinely-open menus.
 *
 * Call immediately after `new Menu()` (before or after `showAtMouseEvent`).
 */
export function registerOpenMenu(menu: Menu): void {
	openMenus.add(menu);
	menu.onHide(() => openMenus.delete(menu));
}

/**
 * Close every still-open tracked menu. Called from the plugin's `onunload` so a
 * reload never leaves an orphaned native popup on screen.
 */
export function closeOpenMenus(): void {
	for (const menu of openMenus) {
		menu.hide();
	}
	openMenus.clear();
}

/** Test-only: current count of tracked open menus. */
export function _openMenuCount(): number {
	return openMenus.size;
}


/**
 * The subset of a React mouse event that {@link showMenuAtEvent} reads.
 * Declared structurally so this module (in utils/) stays free of a React
 * import — the layer constraint forbids React here. A `React.MouseEvent` is
 * assignable to this shape at every call site.
 */
interface MenuTriggerEvent {
	readonly detail: number;
	readonly clientX: number;
	readonly clientY: number;
	readonly currentTarget: Element;
	readonly nativeEvent: MouseEvent;
}

/**
 * Anchor and show a {@link Menu} for a pointer- OR keyboard-triggered event.
 *
 * Keyboard activation of a native control (Enter/Space on a `<button>`) fires a
 * synthesized `click` with `detail === 0` and `clientX/clientY === 0` — there
 * is no cursor. Handing that event to {@link Menu.showAtMouseEvent} drops the
 * menu at the viewport origin instead of the control (the "modal opens in a
 * random place" bug, I115). Detect that case and anchor to the trigger's
 * bottom-left rect. Real mouse clicks and right-click context menus carry
 * genuine coordinates and fall through to cursor-anchored placement.
 *
 * This is the ONLY sanctioned way to position a menu: a `no-restricted-syntax`
 * lint rule forbids calling `showAtMouseEvent` / `showAtPosition` directly
 * outside this module, so every current and future menu is keyboard-correct by
 * construction.
 */
export function showMenuAtEvent(menu: Menu, e: MenuTriggerEvent): void {
	const isKeyboardActivation =
		e.detail === 0 && e.clientX === 0 && e.clientY === 0;
	if (isKeyboardActivation) {
		const rect = e.currentTarget.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom });
	} else {
		menu.showAtMouseEvent(e.nativeEvent);
	}
}
