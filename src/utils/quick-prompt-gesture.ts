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
