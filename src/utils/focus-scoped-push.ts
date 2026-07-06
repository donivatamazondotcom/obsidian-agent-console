import { Scope } from "obsidian";
import type { App } from "obsidian";
import type { IChatViewHost } from "../ui/view-host";
import { resolveChatPushScopeParent } from "./chat-scope-parent";

/**
 * Push a keymap scope onto the GLOBAL app keymap, but only while the owning
 * chat panel actually holds keyboard focus — and pop it the instant focus
 * leaves.
 *
 * WHY (I161): `keymap.pushScope` is global and NOT focus-gated, yet the chat
 * UI parents the scopes it pushes to the focus-gated `ChatView` view scope so
 * an unhandled key falls through to the view's Cmd+W confirm-close guard
 * (I155). If such a pushed scope lingers on the global stack after the panel
 * loses focus, a Cmd+W pressed in an unrelated leaf (e.g. a markdown editor)
 * dispatches to it, misses `w`, and falls through to the view guard — popping
 * the confirm-close modal in the wrong context. Gating the push on
 * `viewHost.hasFocus()` (re-evaluated on focus changes) keeps I155 working
 * while the panel is focused and forecloses the I161 cross-leaf leak when it
 * is not.
 *
 * This is the shared-root fix for BOTH regressions of the Cmd+W confirm-close
 * feature: parenting the pushed scope to the app root under-fires (I155),
 * parenting it to the view scope over-fires (I161) — the real invariant is
 * that a chat-UI pushed scope must never be live while the panel is unfocused.
 *
 * `register` is invoked each time the scope is (re)created, so its handlers
 * always close over current values.
 *
 * @returns cleanup that pops any live scope and unsubscribes the listeners.
 */
export function pushScopeWhileFocused(
	app: App,
	viewHost: IChatViewHost,
	register: (scope: Scope) => void,
): () => void {
	const keymap = app.keymap;
	let scope: Scope | null = null;
	const push = () => {
		if (scope) return;
		scope = new Scope(resolveChatPushScopeParent(viewHost.scope, app.scope));
		register(scope);
		keymap.pushScope(scope);
	};
	const pop = () => {
		if (!scope) return;
		keymap.popScope(scope);
		scope = null;
	};
	const sync = () => (viewHost.hasFocus() ? push() : pop());

	sync();
	// active-leaf-change covers leaf switches (including programmatic reveals);
	// focusin is the precise DOM signal for focus moving in/out of the panel
	// container that `hasFocus()` reads. Both drive the idempotent sync.
	const leafRef = app.workspace.on("active-leaf-change", sync);
	activeDocument.addEventListener("focusin", sync, true);
	return () => {
		pop();
		app.workspace.offref(leafRef);
		activeDocument.removeEventListener("focusin", sync, true);
	};
}
