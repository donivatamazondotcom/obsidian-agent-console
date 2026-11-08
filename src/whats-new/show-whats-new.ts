/**
 * The "Show what's new" command (I300). Forces the card on in every open
 * chat view and reveals the view. If nothing would show (no highlight at or
 * below the running version), it opens the release notes instead. The check
 * uses the resolver's output, not the raw registry.
 */
import {
	deriveWhatsNewHighlights,
	releaseCore,
	releaseNotesUrl,
	type WhatsNewHighlight,
} from "../resolvers/whats-new";
import { HIGHLIGHTS } from "./highlights";
import type { WhatsNewForcedStore } from "./forced-store";

export async function showWhatsNew(deps: {
	currentVersion: string;
	lastSeen: string | undefined;
	forcedStore: WhatsNewForcedStore;
	activateView: () => Promise<void>;
	openUrl: (url: string) => void;
	/** Test seam: the shipped registry by default. */
	highlights?: readonly WhatsNewHighlight[];
}): Promise<void> {
	const current = releaseCore(deps.currentVersion);
	const shown =
		current === undefined
			? []
			: deriveWhatsNewHighlights({
					highlights: deps.highlights ?? HIGHLIGHTS,
					current,
					lastSeen: deps.lastSeen,
					forced: true,
				});
	if (shown.length === 0) {
		const url = releaseNotesUrl(deps.currentVersion);
		if (url !== undefined) deps.openUrl(url);
		return;
	}
	deps.forcedStore.set(true);
	await deps.activateView();
}
