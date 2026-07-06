/**
 * Minimal view interface for chat components.
 *
 * This interface extracts the minimal set of methods that ChatMessages,
 * ChatInput, and other components need from a view. By depending on this
 * interface instead of ChatView directly, these components stay decoupled
 * from the concrete view implementation.
 */

import type { App, Scope } from "obsidian";

/**
 * Minimal interface for components that need view-level DOM event registration.
 *
 * ChatMessages, ChatInput, SuggestionPopup, and ErrorBanner use this
 * for registering scroll and click-outside handlers.
 *
 * Note on `this: HTMLElement` in callback signatures:
 * - This matches Obsidian's Component.registerDomEvent signature for compatibility
 * - In practice, callbacks use arrow functions and don't reference `this`
 * - We maintain this signature to allow ChatView to implement IChatViewHost
 *   without type casting (ChatView extends Component which has this signature)
 */
export interface IChatViewHost {
	/** Obsidian App instance for API access */
	app: App;

	/**
	 * The view's key event scope, or null. `ChatView` registers its
	 * confirm-before-closing Cmd+W handler here. Chat UI components parent the
	 * scopes they `keymap.pushScope` to this one (via
	 * `resolveChatPushScopeParent`) so an unhandled Cmd+W falls through to the
	 * close guard instead of Obsidian's default panel-close (I155).
	 */
	readonly scope: Scope | null;

	/**
	 * Registry-recognized container ID. For sidebar (ChatView) this is
	 * the workspace leaf.id. Used by ChatPanel's focus tracking to write
	 * the value that ViewRegistry.setFocused() accepts (it rejects unknown
	 * viewIds, so writing tab.tabId would silently no-op).
	 */
	readonly viewId: string;

	/**
	 * Foreground the vault window that owns this leaf and make the leaf
	 * active, so a completion/permission notification click lands on the
	 * correct window and leaf rather than Electron's most-recently-active
	 * window (I52 recurrence, 2026-07-06). `ChatView` implements this via
	 * `workspace.revealLeaf` + `setActiveLeaf({ focus: true })`; non-view
	 * hosts (e.g. test stubs) may no-op.
	 */
	revealOwningLeaf(): void;

	/**
	 * Whether keyboard focus is currently within this panel's container
	 * (`ChatView`: `containerEl.contains(activeDocument.activeElement)`).
	 * The chat UI pushes its keymap scopes onto the GLOBAL app keymap only
	 * while the panel is focused, popping them the instant focus leaves.
	 * Otherwise a Cmd+W in another leaf falls through the pushed scope to
	 * ChatView's confirm-close guard (I161). See `utils/focus-scoped-push.ts`.
	 */
	hasFocus(): boolean;

	/**
	 * Register a DOM event listener that will be cleaned up when the view closes.
	 *
	 * In sidebar ChatView, this delegates to Obsidian's Component.registerDomEvent.
	 *
	 * Note: Only Window, Document, and HTMLElement are supported as targets.
	 * This matches the actual usage in components (document for click-outside,
	 * HTMLElement for scroll handlers).
	 */
	registerDomEvent<K extends keyof WindowEventMap>(
		el: Window,
		type: K,
		callback: (this: HTMLElement, ev: WindowEventMap[K]) => unknown,
		options?: boolean | AddEventListenerOptions,
	): void;
	registerDomEvent<K extends keyof DocumentEventMap>(
		el: Document,
		type: K,
		callback: (this: HTMLElement, ev: DocumentEventMap[K]) => unknown,
		options?: boolean | AddEventListenerOptions,
	): void;
	registerDomEvent<K extends keyof HTMLElementEventMap>(
		el: HTMLElement,
		type: K,
		callback: (this: HTMLElement, ev: HTMLElementEventMap[K]) => unknown,
		options?: boolean | AddEventListenerOptions,
	): void;
}
