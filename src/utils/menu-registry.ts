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
