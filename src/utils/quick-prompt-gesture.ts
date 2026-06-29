import { Keymap } from "obsidian";
import type { QuickPromptGesture } from "../services/quick-prompts-logic";

/**
 * Map a DOM event (mouse click, middle-click, or keyboard activation) onto the
 * browser-true 2×2 axes a quick-prompt activation uses:
 *
 * - **`openElsewhere`** — where: `Keymap.isModEvent` is truthy (⌘/⌃, or a
 *   middle-click). Obsidian's sanctioned modifier→pane resolver, so the
 *   new-tab gesture matches the user's platform/Obsidian exactly and inherits
 *   middle-click for free. We clamp the *result* to a tab elsewhere — here we
 *   only read "did they ask to open elsewhere?".
 * - **`foreground`** — ⇧: when opening a new tab, switch to it. Bare ⇧ (no ⌘)
 *   is inert; the decision layer only honors it on a new-tab open.
 * - **`insert`** — ⌥: stage in the composer instead of sending (the browser's
 *   ⌥-click "capture, don't navigate").
 *
 * A missing event (e.g. a programmatic choose) is the plain gesture.
 *
 * Imports `Keymap` (runtime) from `obsidian`, so — like `link-leaf.ts` — it is
 * a sanctioned obsidian-importing util.
 */
export function quickPromptGestureFromEvent(
	evt: MouseEvent | KeyboardEvent | undefined,
): QuickPromptGesture {
	if (!evt) {
		return { openElsewhere: false, foreground: false, insert: false };
	}
	return {
		openElsewhere: Keymap.isModEvent(evt) !== false,
		foreground: evt.shiftKey === true,
		insert: evt.altKey === true,
	};
}

/**
 * Whether a composer `Enter` keydown carries a modifier combo that Obsidian's
 * DEFAULT editor hotkeys steal before the textarea's React `onKeyDown` sees it
 * (QP-I14). The bound combos (verified against the live keymap) are:
 *
 * - `⌥Enter`        → `editor:follow-link`
 * - `⌘/⌃ Enter`     → `editor:open-link-in-new-leaf`
 * - `⌘⌥ Enter`      → `editor:open-link-in-new-split`
 * - `⌘⌥⇧ Enter`     → `editor:open-link-in-new-window`
 *
 * Because they live in the global/editor scope, they never reach the composer,
 * so the `!` quick-prompt dropdown can't act on `⌘Enter` (new-tab background)
 * or `⌥Enter` (insert). A pushed Obsidian `Scope` claims exactly these while
 * the dropdown is open (mirrors ChatView's `Mod+W` scope), routing them to the
 * same selection path. Plain `Enter` and `⌘⇧Enter` are NOT bound by Obsidian,
 * so they reach React normally — this predicate excludes them (the disjoint set
 * the React `handleDropdownKeyPress` path keeps owning).
 *
 * Platform-correct: includes `ctrlKey` so the Windows/Linux `Ctrl`-as-Mod
 * combos are covered the same way (Obsidian binds these editor hotkeys to
 * `Mod`, which is `Ctrl` off macOS).
 */
export function isQuickPromptScopeCombo(e: {
	altKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
}): boolean {
	if (e.altKey) return true; // ⌥, ⌘⌥, ⌘⌥⇧ (Alt is held in all alt-combos)
	if ((e.metaKey || e.ctrlKey) && !e.shiftKey) return true; // ⌘/⌃ without ⇧
	return false; // plain Enter or ⌘⇧Enter — not stolen; React keeps these
}
