/**
 * Pure layout resolvers for the settings pane.
 *
 * Keeps placement/gating decisions out of inline booleans in SettingsTab so
 * both call sites read one source of truth (repo tenet: one decision = one
 * pure, total resolver in utils/ — see [[Resolver and Single-Writer Refactors]]).
 */

/** Where the "Import settings" control renders in the settings pane (D5). */
export type ImportPlacement = "top-matter" | "advanced";

/**
 * Decide where "Import settings" renders.
 *
 * On a fresh / un-configured install it sits in Top matter — the moment a user
 * would import from another machine. Once the one-time setup latch
 * (`hasCompletedSetup`) trips, it moves into the Advanced collapsible.
 *
 * Pure and total: a single boolean in, a closed set of placements out.
 */
export function deriveImportPlacement(
	hasCompletedSetup: boolean,
): ImportPlacement {
	return hasCompletedSetup ? "advanced" : "top-matter";
}
