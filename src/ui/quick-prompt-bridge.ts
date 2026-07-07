/**
 * createQuickPromptBridge — builds the {@link QuickPromptComposerBridge} that
 * exposes a tab's live composer/queue/selection state and the fire/insert
 * effects to the pure quick-prompt engine.
 *
 * Extracted from ChatPanel's inline `useMemo` so the fire/queue/insert effects
 * — especially their composer-focus behaviour — are unit-testable against a
 * real DOM without mounting ChatPanel (which needs a plugin, AcpClient, view,
 * and ~40 props). ChatPanel supplies the live values as thunks over its stable
 * refs; every method reads through them so the bridge never goes stale.
 *
 * Deliberately obsidian-free (no `Notice`, no SDK) so the factory is a plain
 * unit under test; the `notify` side effect is injected by ChatPanel.
 *
 * See [[Agent Console Quick Prompts and Workflows]] § Architecture and
 * 04-initiatives/Agent Console/QP-I20 Quick-prompt fire does not return focus to composer.md.
 */

import type { QuickPromptComposerBridge } from "../hooks/useQuickPrompts";
import { scheduleComposerRefocus } from "./composer-focus";

/** Live, per-tab dependencies the bridge reads/drives. All thunks so the bridge stays fresh. */
export interface QuickPromptBridgeDeps {
	/** Current unsent composer text. */
	getComposerText: () => string;
	/** Editor selection text captured while the editor was focused (QP-I03), or null. */
	getSelectionText: () => string | null;
	/** A turn is streaming (queue slot empty). */
	isSending: () => boolean;
	/** The tab's lazy session is live enough to accept a direct send. */
	isSessionLive: () => boolean;
	/** A message is already queued (slot full → composer locked). */
	isQueued: () => boolean;
	/** Set the composer text (React state). */
	setComposerText: (text: string) => void;
	/** Queue `text` as the next message (locks the composer). */
	queueMessage: (text: string) => void;
	/** Dispatch `text` through the normal send path. */
	sendMessage: (text: string) => void;
	/** Spawn a sibling tab and seed/send `text` there (newTab prompts). */
	openInNewTab: (
		text: string,
		opts: { send: boolean; foreground: boolean },
	) => void;
	/** This view's container element (holds the composer textarea), or null. */
	getContainer: () => HTMLElement | null;
	/** Show a transient notice. */
	notify: (message: string) => void;
}

/** CSS selector for the composer textarea (same one ChatView.focus uses). */
const COMPOSER_SELECTOR = "textarea.agent-client-chat-input-textarea";

export function createQuickPromptBridge(
	deps: QuickPromptBridgeDeps,
): QuickPromptComposerBridge {
	return {
		getComposerText: () => deps.getComposerText(),
		getSelectionText: () => deps.getSelectionText(),
		isStreaming: () => deps.isSending(),
		isQueued: () => deps.isQueued(),
		// fire/queue: dispatch the resolved text through the same send path the
		// composer uses (queues while streaming / pre-ready). The engine only
		// routes here when the composer is empty, so passing the text directly
		// never clobbers a draft.
		fireOrQueue: (text) => {
			if (deps.isSending() || !deps.isSessionLive()) {
				if (deps.isQueued()) return; // slot full (defensive)
				// Seed the composer so it mirrors the queued content. The
				// composer is the single source of truth the Edit flow relies
				// on — handleEditQueued only unlocks it, it does not repopulate.
				// Without this the quick prompt queues but the composer is empty,
				// so Edit shows no draft (QP-I04). Safe: the engine only routes
				// here when the composer was empty (unsent-draft guard), and the
				// turn-end flush both consumes the queue entry once AND clears
				// the composer.
				deps.setComposerText(text);
				deps.queueMessage(text);
			} else {
				deps.setComposerText("");
				deps.sendMessage(text);
			}
			// QP-I20: return focus to the composer after a fire/queue. A chip
			// fire (or a picker mouse-pick) leaves DOM focus on the chip/row, so
			// without this the caret never comes back and the user can't keep
			// typing. Send-type actions own their focus (the composer-focus-
			// return cluster guard excludes them), so refocus unconditionally —
			// mirroring insertAtCursor below. Skipped only on the defensive
			// slot-full early-return above (nothing fired).
			scheduleComposerRefocus(deps.getContainer());
		},
		// insert: splice the resolved text at the caret, preserving the existing
		// draft. Reads the composer textarea from this view's container.
		insertAtCursor: (text) => {
			const el = deps.getContainer()?.querySelector(COMPOSER_SELECTOR);
			const current = deps.getComposerText();
			let next: string;
			let caret: number;
			if (el instanceof HTMLTextAreaElement) {
				const start = el.selectionStart ?? current.length;
				const end = el.selectionEnd ?? current.length;
				next = current.slice(0, start) + text + current.slice(end);
				caret = start + text.length;
			} else {
				next = current.length > 0 ? `${current}\n${text}` : text;
				caret = next.length;
			}
			deps.setComposerText(next);
			window.requestAnimationFrame(() => {
				if (el instanceof HTMLTextAreaElement) {
					el.focus();
					el.setSelectionRange(caret, caret);
				}
			});
		},
		// newTab quick prompts route up to ChatView (which owns the tab
		// manager) to spawn a sibling tab and seed/send into it. Never touches
		// this tab's composer.
		openInNewTab: (text, opts) => {
			deps.openInNewTab(text, opts);
		},
		notify: (message) => {
			deps.notify(message);
		},
	};
}
