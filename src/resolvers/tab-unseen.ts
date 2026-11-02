/**
 * The unseen-result flag for a tab — [[Tab Attention States]] § Unseen flag.
 *
 * A turn that ends while the user isn't looking at the tab marks it, so the
 * strip can show "finished" (tick) or "stopped early". Looking at the tab, or
 * starting another send, clears the mark. A cancelled turn never marks it:
 * the user stopped it on purpose.
 *
 * Pure — no React, no Obsidian. ChatPanel owns the state and feeds events in.
 * "Being viewed" is one function too, because VS Code's unread marks broke
 * every time two code paths disagreed about whether a chat was visible.
 */
import type { TabUnseen } from "../types/tab";
import type { TurnStopKind } from "../types/session";

export type TabUnseenEvent =
	| { type: "turnEnded"; outcome: TurnStopKind | "failed"; viewed: boolean }
	| { type: "viewed" }
	| { type: "sendStarted" };

export function nextTabUnseen(
	prev: TabUnseen,
	event: TabUnseenEvent,
): TabUnseen {
	switch (event.type) {
		case "viewed":
		case "sendStarted":
			return null;
		case "turnEnded": {
			if (event.viewed) return null;
			switch (event.outcome) {
				case "cancelled":
					return null;
				case "maxTokens":
				case "maxRequests":
				case "refusal":
				case "failed":
					return { kind: "stopped" };
				case "endTurn":
				case "unknown":
					// An unrecognized stop reason still means "something finished".
					return { kind: "done" };
			}
		}
	}
}

export interface ViewedInput {
	/** This tab is the selected tab in its leaf. */
	isActiveTab: boolean;
	/** The leaf's container is rendered (not a background leaf / collapsed sidebar). */
	isLeafShown: boolean;
	visibilityState: DocumentVisibilityState;
	/** The window that owns the leaf has focus. */
	hasFocus: boolean;
}

/** The user can see this tab right now. All four signals must hold. */
export function isBeingViewed(input: ViewedInput): boolean {
	return (
		input.isActiveTab &&
		input.isLeafShown &&
		input.visibilityState === "visible" &&
		input.hasFocus
	);
}
