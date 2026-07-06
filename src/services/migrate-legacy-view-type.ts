import { VIEW_TYPE_CHAT } from "../ui/chat-view-type";

/**
 * The view type this plugin registered before v2.0.1 (I157). It is the SAME
 * string the upstream Agent Client plugin registers, so with both plugins
 * enabled, whichever loaded second threw in `registerView` ("Attempting to
 * register an existing view type") and its `onload` aborted — for an existing
 * Agent Client user adding this plugin, that meant Agent Console silently
 * failed to load. v2.0.1 renames our view type to `VIEW_TYPE_CHAT`
 * ("agent-console-chat-view") so the two can coexist. This module migrates any
 * leaves persisted under the old type so existing users' open panels survive
 * the update.
 */
export const LEGACY_CHAT_VIEW_TYPE = "agent-client-chat-view";

/** Minimal WorkspaceLeaf surface needed for the migration (test-seam).
 *  Field list is deliberately narrow so Obsidian's `ViewState` (no index
 *  signature) is structurally assignable; the runtime spread in
 *  {@link migrateLegacyChatViewType} still carries any extra ViewState fields
 *  (pinned, group) through unchanged. */
export interface MigratableLeaf {
	getViewState(): { type?: string; state?: unknown; active?: boolean };
	setViewState(state: {
		type: string;
		state?: unknown;
		active?: boolean;
	}): void | Promise<void>;
}

/** Minimal Workspace surface needed for the migration (test-seam). */
export interface MigratableWorkspace {
	iterateAllLeaves(callback: (leaf: MigratableLeaf) => void): void;
}

/**
 * Re-home any workspace leaf still persisted under {@link LEGACY_CHAT_VIEW_TYPE}
 * to the current {@link VIEW_TYPE_CHAT}, preserving its ViewState. Because
 * `setViewState` reuses the same leaf, `leaf.id` is unchanged — so the tab /
 * session slice, which is keyed on `leaf.id` (I47), re-associates when the
 * ChatView remounts under the new type.
 *
 * Idempotent: leaves already on the new type (or any other type) are left
 * untouched. Returns the number of leaves migrated, for logging.
 *
 * Runtime note: this relies on Obsidian retaining a leaf whose view type is no
 * longer registered as a deferred/empty leaf whose `getViewState().type` still
 * reports the old string — the standard behavior that makes view-type renames
 * migratable. Verified end-to-end by the update-path smoke test on a real
 * pre-2.0.1 workspace.
 */
export function migrateLegacyChatViewType(
	workspace: MigratableWorkspace,
): number {
	const toMigrate: {
		leaf: MigratableLeaf;
		prev: ReturnType<MigratableLeaf["getViewState"]>;
	}[] = [];
	workspace.iterateAllLeaves((leaf) => {
		const prev = leaf.getViewState();
		if (prev.type === LEGACY_CHAT_VIEW_TYPE) {
			toMigrate.push({ leaf, prev });
		}
	});
	for (const { leaf, prev } of toMigrate) {
		void leaf.setViewState({ ...prev, type: VIEW_TYPE_CHAT });
	}
	return toMigrate.length;
}
