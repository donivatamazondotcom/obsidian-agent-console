/**
 * Decision for the legacy Obsidian view-state agent restore
 * (`ChatView.onAgentIdRestored`). Pure — no React, unit-testable in isolation.
 *
 * On reload there are two restore paths for a leaf:
 *
 *   1. Synchronous rich restore from `perLeafTabStates` — seeds `useTabManager`
 *      with the persisted tabs, each carrying its correct per-tab `agentId`
 *      and `tabId` (and `restoredMessages` keyed by that same `tabId`).
 *   2. Legacy single-agent view-state restore — `setState` restores one
 *      `initialAgentId` and fires `onAgentIdRestored`, whose handler appends a
 *      tab via `tabManager.addTab`.
 *
 * When path 1 already restored the leaf, firing path 2 on top of it appends a
 * spurious tab that activates over the rich-restored active tab — reverting it
 * to the wrong/default agent (TP-I05) and, because the appended tab has no
 * `restoredMessages` entry, rehydrating it from a diff-less `session/load`
 * replay so Shared Links new/old classification goes flat (SLB-I6).
 *
 * So the view-state path applies ONLY when the leaf was NOT restored from
 * persistence — e.g. "Restore tabs on startup" off, or a leaf with no
 * persisted slice (where `useTabManager` created a default initial tab the
 * view-state agent is meant to populate).
 *
 * See [[TP-I05 Restored tab reverts to default agent (view-state agentId clobbers per-tab persistence)]].
 */
export function shouldApplyViewStateAgentRestore(args: {
	/** True when the leaf's tabs were seeded synchronously from `perLeafTabStates`. */
	restoredFromPersistence: boolean;
}): boolean {
	return !args.restoredFromPersistence;
}
