import { useEffect } from "react";
import type { Scope } from "obsidian";
import type AgentClientPlugin from "../plugin";
import type { IChatViewHost } from "./view-host";
import { PILL_PATH_ATTR } from "./ContextStrip";
import { pushScopeWhileFocused } from "../utils/focus-scoped-push";

/**
 * Push a keymap scope that opens the focused context pill on the ⌘/⌥/⌃/⇧+Enter
 * combos (Obsidian's editor hotkeys otherwise claim them before a focused
 * pill's React onKeyDown can see them — the QP-I14 pattern). When no pill is
 * focused the handler returns void so those editor hotkeys still fire.
 *
 * **Gated on `isActive` (I156).** Every tab's `ChatPanel` stays mounted
 * (inactive tabs are `display:none`), so pushing per-tab put one redundant
 * scope per tab on `app.keymap`. Pushing only for the active tab keeps exactly
 * one such scope live.
 *
 * **Gated on panel focus (I161).** The push is delegated to
 * `pushScopeWhileFocused`, which only puts the scope on the global keymap while
 * the panel holds focus and pops it the instant focus leaves. The scope is
 * parented to the view scope (I155) so an unhandled key falls through to
 * ChatView's Cmd+W confirm-close guard — but ONLY while the panel is focused,
 * so a Cmd+W in another leaf (e.g. a markdown editor) no longer leaks to the
 * guard. A context pill is only focusable while the panel is focused, so this
 * gate is behavior-preserving for the pill feature.
 *
 * See [[I155 …]], [[I156 …]], and [[I161 …]].
 */
export function usePillOpenScope(
	plugin: AgentClientPlugin,
	viewHost: IChatViewHost,
	isActive: boolean,
	openContextNote: (path: string, evt: KeyboardEvent) => void,
): void {
	useEffect(() => {
		if (!isActive) return;
		return pushScopeWhileFocused(plugin.app, viewHost, (scope: Scope) => {
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
		});
	}, [plugin, viewHost, isActive, openContextNote]);
}
