/**
 * `commitTabRename` — the save step of the tab rename flow (ChatView's
 * `handleRenameTab`, fed by `EditTitleModal`).
 *
 * Order: reject a duplicate name → apply the rename (label + single-writer
 * persist, via ChatView's shared `applyTabRename`; not awaited) → apply the
 * `rename-tab` focus contract. The contract matters
 * because right-clicking a tab focuses it and Obsidian's modal-close restores
 * focus there, leaving the user on the tab instead of ready to type (TS-I09).
 * Refocus does not wait for persistence: the label is already visible, and a
 * slow disk write should not delay the caret.
 *
 * A duplicate name does NOT refocus — the user is told and may want to retry.
 * Cancelling never reaches this function; ChatView applies the same
 * `rename-tab` contract from EditTitleModal's `onDismiss` instead.
 */
import { applyComposerFocus } from "../resolvers/composer-focus";

export interface CommitTabRenameInput {
	tabId: string;
	newTitle: string;
	tabs: ReadonlyArray<{ tabId: string; label: string }>;
	/** Label truncation used when a label is stored (duplicate check matches it). */
	truncate: (title: string) => string;
	/**
	 * Set the label and persist through the session single writer. The label
	 * must be set synchronously (before the first await); the promise is not
	 * awaited.
	 */
	apply: (title: string) => Promise<void>;
	notifyDuplicate: () => void;
	/** Return focus to the active tab's composer. */
	refocus: () => void;
}

export type CommitTabRenameResult = "saved" | "duplicate";

export function commitTabRename({
	tabId,
	newTitle,
	tabs,
	truncate,
	apply,
	notifyDuplicate,
	refocus,
}: CommitTabRenameInput): CommitTabRenameResult {
	const duplicate = tabs.some(
		(t) => t.tabId !== tabId && t.label === truncate(newTitle),
	);
	if (duplicate) {
		notifyDuplicate();
		return "duplicate";
	}
	void apply(newTitle).catch((err: unknown) => {
		console.error("[AgentConsole] Tab rename persist failed", err);
	});
	applyComposerFocus("rename-tab", {
		focusUnconditional: refocus,
		focusGuarded: refocus,
	});
	return "saved";
}
