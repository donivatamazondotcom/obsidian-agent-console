import { useEffect } from "react";
import { Scope } from "obsidian";
import type AgentClientPlugin from "../plugin";
import type { IChatViewHost } from "./view-host";
import { PILL_PATH_ATTR } from "./ContextStrip";
import { resolveChatPushScopeParent } from "../utils/chat-scope-parent";

/**
 * Push a keymap scope that opens the focused context pill on the ⌘/⌥/⌃/⇧+Enter
 * combos (Obsidian's editor hotkeys otherwise claim them before a focused
 * pill's React onKeyDown can see them — the QP-I14 pattern). When no pill is
 * focused the handler returns void so those editor hotkeys still fire.
 *
 * **Gated on `isActive` (I156).** Every tab's `ChatPanel` stays mounted
 * (inactive tabs are `display:none`), so pushing unconditionally put one
 * redundant scope per tab on `app.keymap` — N scopes for N tabs. Inactive
 * panels' pills aren't focusable, so their scopes never fire; they only
 * clutter the scope stack (and were what buried the view scope pre-I155).
 * Pushing only for the active tab keeps exactly one such scope live.
 *
 * The scope is parented to the view scope via `resolveChatPushScopeParent` so
 * an unhandled key (e.g. Cmd+W) falls through to the view's handlers (I155).
 *
 * See [[I156 Chat-UI pushed keymap scopes accumulate]].
 */
export function usePillOpenScope(
	plugin: AgentClientPlugin,
	viewHost: IChatViewHost,
	isActive: boolean,
	openContextNote: (path: string, evt: KeyboardEvent) => void,
): void {
	useEffect(() => {
		if (!isActive) return;
		const keymap = plugin.app.keymap;
		const scope = new Scope(
			resolveChatPushScopeParent(viewHost.scope, plugin.app.scope),
		);
		const handler = (evt: KeyboardEvent): false | void => {
			const path =
				activeDocument.activeElement?.getAttribute(PILL_PATH_ATTR);
			if (!path) return; // not on a pill — fall through to Obsidian
			openContextNote(path, evt);
			return false; // consume
		};
		scope.register(["Alt"], "Enter", handler);
		scope.register(["Mod"], "Enter", handler);
		scope.register(["Mod", "Alt"], "Enter", handler);
		scope.register(["Mod", "Alt", "Shift"], "Enter", handler);
		keymap.pushScope(scope);
		return () => keymap.popScope(scope);
	}, [plugin, viewHost, isActive, openContextNote]);
}
