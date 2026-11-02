/**
 * useTabUnseen — the runtime half of [[Tab Attention States]].
 *
 * Feeds turn ends, sends, and "the user may have started looking" events into
 * the pure `nextTabUnseen` reducer, using one `isBeingViewed` check for every
 * decision. Returns the current flag for `deriveTabState`.
 *
 * Events that can start the user looking: this tab becoming active, the
 * owning window gaining focus, the document becoming visible, and a click or
 * focus inside the panel (e.g. after revealing a collapsed sidebar).
 */
import * as React from "react";
import { isBeingViewed, nextTabUnseen } from "../resolvers/tab-unseen";
import type { TabUnseen } from "../types/tab";
import type { TurnEnd } from "./useAgentMessages";

const { useCallback, useEffect, useReducer, useRef } = React;

export interface UseTabUnseenInput {
	lastTurnEnd: TurnEnd | null;
	isSending: boolean;
	isActive: boolean;
	containerRef: React.RefObject<HTMLElement | null>;
}

export function useTabUnseen(input: UseTabUnseenInput): TabUnseen {
	const { lastTurnEnd, isSending, isActive, containerRef } = input;
	const [unseen, dispatch] = useReducer(nextTabUnseen, null);

	const isActiveRef = useRef(isActive);
	isActiveRef.current = isActive;

	const viewedNow = useCallback((): boolean => {
		const container = containerRef.current;
		const doc = container?.ownerDocument ?? activeDocument;
		return isBeingViewed({
			isActiveTab: isActiveRef.current,
			// Obsidian's HTMLElement.isShown(); absent in jsdom, so assume shown.
			isLeafShown:
				container && typeof container.isShown === "function"
					? container.isShown()
					: true,
			visibilityState: doc.visibilityState,
			hasFocus: doc.hasFocus(),
		});
	}, [containerRef]);

	useEffect(() => {
		if (!lastTurnEnd) return;
		dispatch({
			type: "turnEnded",
			outcome: lastTurnEnd.outcome,
			viewed: viewedNow(),
		});
	}, [lastTurnEnd, viewedNow]);

	useEffect(() => {
		if (isSending) dispatch({ type: "sendStarted" });
	}, [isSending]);

	useEffect(() => {
		const markIfViewed = () => {
			if (viewedNow()) dispatch({ type: "viewed" });
		};
		markIfViewed();
		const container = containerRef.current;
		const doc = container?.ownerDocument ?? activeDocument;
		const win = doc.defaultView ?? activeWindow;
		win.addEventListener("focus", markIfViewed);
		doc.addEventListener("visibilitychange", markIfViewed);
		container?.addEventListener("focusin", markIfViewed);
		container?.addEventListener("pointerdown", markIfViewed);
		return () => {
			win.removeEventListener("focus", markIfViewed);
			doc.removeEventListener("visibilitychange", markIfViewed);
			container?.removeEventListener("focusin", markIfViewed);
			container?.removeEventListener("pointerdown", markIfViewed);
		};
	}, [isActive, viewedNow, containerRef]);

	return unseen;
}
