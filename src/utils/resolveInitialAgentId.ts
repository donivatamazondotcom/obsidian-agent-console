/**
 * Resolve the agent a freshly-created (non-restored) tab should open on.
 *
 * When "Restore tabs on startup" is OFF, a reopened view is a *fresh* view, so
 * it must honor the Default Agent setting — NOT the Obsidian view-state's
 * last-active agent (which `getState`/`setState` persists independently of the
 * restore setting). When restore is ON, the view-state agent provides
 * continuity for a leaf that has no per-tab persisted slice yet; per-tab
 * restore (perLeafTabStates) supplies agents when a slice exists.
 *
 * See [[TP-I05 …]] (restore-OFF finding) and
 * [[Tab Agent Identity and Session Acquisition Unification]].
 */
export function resolveInitialAgentId(args: {
	/** Whether "Restore tabs on startup" is enabled. */
	restoreEnabled: boolean;
	/** Obsidian view-state agent (the last-active agent), or null. */
	viewStateAgentId: string | null;
	/** The Default Agent setting. */
	defaultAgentId: string;
}): string {
	const { restoreEnabled, viewStateAgentId, defaultAgentId } = args;
	return (restoreEnabled ? viewStateAgentId : null) ?? defaultAgentId;
}
