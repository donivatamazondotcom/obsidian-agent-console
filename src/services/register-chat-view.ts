import type { View, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_CHAT } from "../ui/chat-view-type";

/** Minimal `Plugin.registerView` surface — test-seam. */
export interface ChatViewRegistrar {
	registerView(
		type: string,
		viewCreator: (leaf: WorkspaceLeaf) => View,
	): unknown;
}

/**
 * Register the chat view, converting a duplicate-view-type collision into a
 * plain-language notice instead of an uncaught `onload` crash (I157).
 *
 * The I157 rename to "agent-console-chat-view" already stops the known
 * collision with the upstream Agent Client plugin, so this is defense-in-depth
 * for any future or residual collision (another plugin adopting the same type,
 * a stale duplicate install) AND the unit-testable regression guard for the
 * crash class that silently aborted onload before the fix. Returns true if the
 * view registered, false if a collision was caught and handled.
 */
export function registerChatViewSafely(
	registrar: ChatViewRegistrar,
	viewCreator: (leaf: WorkspaceLeaf) => View,
	notify: (message: string) => void,
	logError?: (message: string, error: unknown) => void,
): boolean {
	try {
		registrar.registerView(VIEW_TYPE_CHAT, viewCreator);
		return true;
	} catch (error) {
		logError?.(`registerView("${VIEW_TYPE_CHAT}") failed`, error);
		notify(
			"Agent Console couldn't open its panel because another plugin is " +
				"using the same view. Please disable one of the two plugins and " +
				"reload Obsidian.",
		);
		return false;
	}
}
