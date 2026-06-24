import { Keymap, type PaneType } from "obsidian";

/**
 * Derive the target pane type for opening an internal link from a mouse event.
 *
 * Thin wrapper over `Keymap.isModEvent` — Obsidian's sanctioned API for
 * translating a mouse event into the pane that should open. Per the official
 * docs, `isModEvent` returns:
 *
 * - `'tab'`    → Cmd/Ctrl is held, OR the event is a middle-click
 * - `'split'`  → Cmd/Ctrl + Alt
 * - `'window'` → Cmd/Ctrl + Alt + Shift
 * - `false`    → no modifier (the caller then honors the global
 *                `alwaysOpenInNewTab` setting)
 *
 * The return value is passed straight to {@link Workspace.openLinkText} as its
 * `newLeaf` argument.
 *
 * Delegating to `isModEvent` (rather than hand-rolling the modifier→pane map)
 * keeps every chat-panel link surface — assistant wikilinks in
 * `MarkdownRenderer`, user `@[[mentions]]` and the auto-mention badge in
 * `MessageBubble`, and the context-strip pill in `ChatPanel` — in lockstep with
 * Obsidian's native editor-link behavior, automatically tracking any future
 * change to that mapping across versions and platforms. It also covers
 * middle-click natively, so callers don't need a separate `button === 1` check.
 *
 * Imports `Keymap` (runtime) and `PaneType` (type) from `obsidian`, so — like
 * `platform.ts` — it is a sanctioned obsidian-importing util.
 */
export function deriveNewLeaf(evt: MouseEvent): PaneType | boolean {
	return Keymap.isModEvent(evt);
}

/**
 * Source id shared between `Plugin.registerHoverLinkSource` (in plugin.ts) and
 * the `hover-link` event dispatched from chat link surfaces. Both must use the
 * same id for the Page Preview core plugin to associate the popover with this
 * plugin and honor its per-source modifier setting.
 */
export const HOVER_LINK_SOURCE = "agent-console";
