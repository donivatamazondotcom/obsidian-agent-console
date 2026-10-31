/**
 * useLinkOriginTab — per-tab state for a tab opened by an
 * `obsidian://agent-console` link ([[Agent Console Quick Prompt URIs]]).
 *
 * - `initialAutoContextSuppressed`: seeds ChatPanel's provisional-pill
 *   suppress flag, so a URI fire never offers or crystallizes the active-note
 *   pill (the open note has nothing to do with where the link came from).
 * - The "Opened by link" banner: shown when the link chose the agent or mode,
 *   until the first message lands or the user dismisses it. Sticky-off: it
 *   never comes back for this tab. Not persisted (a restored tab has no
 *   banner — it is about the moment of opening).
 */
import { useCallback, useEffect, useState } from "react";

export interface LinkOriginSeed {
	text: string;
	send: boolean;
	linkOrigin?: boolean;
	suppressAutoContext?: boolean;
}

export interface UseLinkOriginTabArgs {
	initialPrompt: LinkOriginSeed | undefined;
	messageCount: number;
}

export interface UseLinkOriginTabReturn {
	initialAutoContextSuppressed: boolean;
	bannerVisible: boolean;
	dismissBanner: () => void;
}

export function useLinkOriginTab({
	initialPrompt,
	messageCount,
}: UseLinkOriginTabArgs): UseLinkOriginTabReturn {
	// Read once at mount: the seed is one-shot, like ChatPanel's consumer.
	const [initialAutoContextSuppressed] = useState(
		() => initialPrompt?.suppressAutoContext === true,
	);
	const [bannerVisible, setBannerVisible] = useState(
		() => initialPrompt?.linkOrigin === true,
	);

	useEffect(() => {
		if (bannerVisible && messageCount > 0) setBannerVisible(false);
	}, [bannerVisible, messageCount]);

	const dismissBanner = useCallback(() => setBannerVisible(false), []);

	return {
		initialAutoContextSuppressed,
		bannerVisible: bannerVisible && messageCount === 0,
		dismissBanner,
	};
}
