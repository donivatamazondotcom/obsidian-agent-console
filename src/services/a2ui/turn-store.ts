/**
 * I376: a small per-panel store for the tab's turn state, read only by the
 * A2UI surface hosts that need it (`ui/a2ui-turn-context.ts`). Keeping these
 * five values off the context every message bubble receives means a turn
 * starting or ending re-renders the live surface, not the whole transcript.
 *
 * Same shape as `services/turn-activity-store.ts`. No React here.
 */
import type { TabSessionState } from "../../types/tab";

export interface A2uiTurnState {
	/** A turn is streaming in this tab. */
	isSending: boolean;
	/** The queue-of-one slot is occupied. */
	isQueued: boolean;
	/** Session history is loading. */
	isRestoringSession: boolean;
	/** Per-tab session lifecycle state (drives reconnect-on-click, A2UI-I08). */
	sessionState: TabSessionState;
	/** surfaceId of an action held for reconnect, or null. */
	heldSurfaceId: string | null;
}

export interface A2uiTurnStore {
	getSnapshot: () => A2uiTurnState;
	subscribe: (listener: () => void) => () => void;
	/** Replace the snapshot; keeps it (and notifies no one) when nothing changed. */
	publish: (next: A2uiTurnState) => void;
}

export function sameA2uiTurnState(a: A2uiTurnState, b: A2uiTurnState): boolean {
	return (
		a.isSending === b.isSending &&
		a.isQueued === b.isQueued &&
		a.isRestoringSession === b.isRestoringSession &&
		a.sessionState === b.sessionState &&
		a.heldSurfaceId === b.heldSurfaceId
	);
}

export function createA2uiTurnStore(initial: A2uiTurnState): A2uiTurnStore {
	let snapshot: A2uiTurnState = { ...initial };
	const listeners = new Set<() => void>();
	return {
		getSnapshot: () => snapshot,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		publish: (next) => {
			if (sameA2uiTurnState(next, snapshot)) return;
			snapshot = { ...next };
			for (const listener of [...listeners]) listener();
		},
	};
}
