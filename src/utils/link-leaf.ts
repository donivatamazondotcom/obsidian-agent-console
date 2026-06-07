import { Keymap, type PaneType } from "obsidian";

/**
 * Derive the target pane type for opening an internal link from a mouse event,
 * matching Obsidian's standard link-click semantics in the editor:
 *
 * - middle-click            → new tab
 * - Cmd/Ctrl + Alt + click  → split pane
 * - Cmd/Ctrl + click        → new tab
 * - plain click             → `false` (honor the user's `alwaysOpenInNewTab` setting)
 *
 * The returned value is passed straight to {@link Workspace.openLinkText} as its
 * `newLeaf` argument. `false` lets Obsidian apply the global "always open in new
 * tab" preference, which is why a plain click already worked before this helper.
 *
 * `Keymap.isModEvent` is used for the modifier check because it resolves the
 * platform-correct mod key (Cmd on macOS, Ctrl on Windows/Linux). Middle-click is
 * checked explicitly via `evt.button === 1` rather than relying on `isModEvent`,
 * whose middle-click handling is undocumented in the public typings.
 *
 * This is the single shared definition for all chat-panel link render paths
 * (assistant wikilinks in `MarkdownRenderer`, user `@[[mentions]]` and the
 * auto-mention badge in `MessageBubble`). It imports `Keymap` (runtime) and
 * `PaneType` (type) from `obsidian`, so — like `platform.ts` — it is a sanctioned
 * obsidian-importing util rather than a pure helper.
 */
export function deriveNewLeaf(evt: MouseEvent): PaneType | boolean {
	// Middle-click → new tab. Checked first so modifier state is irrelevant.
	if (evt.button === 1) return "tab";
	// Cmd/Ctrl + Alt → split pane.
	if (Keymap.isModEvent(evt) && evt.altKey) return "split";
	// Cmd/Ctrl → new tab.
	if (Keymap.isModEvent(evt)) return "tab";
	// Plain click → honor the global alwaysOpenInNewTab setting.
	return false;
}
