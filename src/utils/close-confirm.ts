/**
 * Pure decision logic for the "confirm before closing a panel with multiple
 * chats" feature.
 *
 * The Agent Console panel is a single Obsidian leaf that can host multiple
 * tabs (independent agent sessions). A focused Cmd+W tears down the whole
 * leaf — and with it every running agent — in one keystroke, with no recovery
 * path for the lost sessions. This predicate decides whether that close should
 * be gated by a confirmation modal.
 *
 * See [[ACP Confirm Close With Multiple Tabs]].
 *
 * Kept as a standalone pure function so the decision is unit-testable without
 * an Obsidian runtime (the Scope/Modal wiring around it is not).
 */

/** Tab count at or above which the close is considered "multiple chats". */
export const MULTI_TAB_THRESHOLD = 2;

/**
 * Should closing the panel be gated by a confirmation modal?
 *
 * @param tabCount - number of open tabs in the panel being closed
 * @param enabled - the `confirmCloseWithMultipleTabs` setting value
 * @returns true when the setting is on AND the panel has 2+ tabs; false
 *          otherwise (single-tab close is unambiguous; setting off opts out).
 */
export function shouldConfirmClose(tabCount: number, enabled: boolean): boolean {
	return enabled && tabCount >= MULTI_TAB_THRESHOLD;
}
