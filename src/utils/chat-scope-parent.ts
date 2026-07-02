import type { Scope } from "obsidian";

/**
 * Which scope should a chat-UI `keymap.pushScope` scope be parented to?
 *
 * Obsidian dispatches a key event to the single active scope and, if that
 * scope doesn't handle the key, falls through **only along that scope's
 * constructor `.parent` chain** — never sideways to other scopes on the push
 * stack, and never to a focused `View`'s scope. So a scope the chat UI pushes
 * (for context-pill / quick-prompt Enter combos) that is parented to the app
 * root scope will, while active, let an unhandled `Cmd/Ctrl+W` fall straight
 * through to Obsidian's default panel-close — bypassing `ChatView`'s
 * confirm-before-closing handler registered on the view scope (I155).
 *
 * Parenting the pushed scope to the **view scope** instead keeps the view's
 * hotkeys (notably the Cmd+W close guard) reachable via fall-through, while
 * preserving the Enter-combo behavior: an unhandled Enter still falls through
 * view scope → its parent (app root) → Obsidian's editor hotkeys.
 *
 * See [[I155 Cmd+W confirm-close modal bypassed by pushed context-pill scope]].
 *
 * @param viewScope - the focused view's scope (`IChatViewHost.scope`), or null
 * @param appScope - the app root scope (`plugin.app.scope`), the fallback
 * @returns the view scope when present, otherwise the app root scope
 */
export function resolveChatPushScopeParent(
	viewScope: Scope | null,
	appScope: Scope,
): Scope {
	return viewScope ?? appScope;
}
