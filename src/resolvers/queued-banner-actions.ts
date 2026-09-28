/**
 * `deriveQueuedBannerActions` — which buttons the queued-message banner shows.
 *
 * The locked composer's banner used to hand-branch Edit/Delete vs Cancel
 * inline in InputArea. Adding Send now made it a three-way decision, so it
 * lives here as one pure resolver the banner renders from.
 *
 * Pure — no React, no Obsidian.
 */

/** One button on the queued banner. */
export type QueuedBannerAction = "sendNow" | "edit" | "delete" | "cancel";

/**
 * Which buttons the queued banner shows, in display order.
 *
 * - A held surface action gets only Cancel (Delete would wipe an unrelated
 *   draft; Send now does not apply — A2UI-I08).
 * - Queued composer text gets Edit + Delete, plus Send now first once the
 *   session is live. While still connecting the message already sends the
 *   moment the session is ready, so Send now would add nothing.
 *
 * Pure — the single decision the banner renders from.
 */
export function deriveQueuedBannerActions(params: {
	isAction: boolean;
	isSessionReady: boolean;
}): QueuedBannerAction[] {
	if (params.isAction) return ["cancel"];
	return params.isSessionReady
		? ["sendNow", "edit", "delete"]
		: ["edit", "delete"];
}
