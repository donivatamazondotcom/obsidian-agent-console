/**
 * Chat Timestamps PR 3: the React binding for the per-panel turn-activity
 * store (`services/turn-activity-store.ts`). ChatPanel provides its store;
 * a leaf reads one string with `useTurnActivitySlice`, so it re-renders only
 * when that string changes. Outside a provider the store is always empty.
 */
import {
	createContext,
	useCallback,
	useContext,
	useLayoutEffect,
	useRef,
	useSyncExternalStore,
} from "react";
import type { TurnActivity } from "../types/chat-time";
import {
	createTurnActivityStore,
	type TurnActivitySnapshot,
	type TurnActivityStore,
} from "../services/turn-activity-store";

/** Never published to, so a leaf outside a panel shows nothing. */
const EMPTY_STORE: TurnActivityStore = createTurnActivityStore();

export const TurnActivityStoreContext = createContext<TurnActivityStore>(EMPTY_STORE);

/** One string (or null) from the panel's store; re-renders only when it changes. */
export function useTurnActivitySlice<T extends string | number | null>(
	selector: (snapshot: TurnActivitySnapshot) => T,
): T {
	const store = useContext(TurnActivityStoreContext);
	const getSnapshot = useCallback(() => selector(store.getSnapshot()), [store, selector]);
	return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * The per-panel ticker (spec § Ticker and store). While `active` (the
 * panel's turn runs and its tab is visible) it publishes `compute()` once
 * at once, in a layout effect so a send or a tab switch paints the line
 * with text, then every second. Its cleanup stops the interval and resets
 * the store, so a new turn never opens with the last turn's line. A null
 * result (no live turn to read) publishes the empty snapshot. `compute`
 * is read through a ref, so it may change every render. A change to `kick`
 * (the permission flag) ticks at once, so the line is fresh the moment a
 * permission is answered rather than up to a second later.
 */
export function useTurnActivityTicker(
	active: boolean,
	store: TurnActivityStore,
	compute: () => TurnActivity | null,
	kick?: unknown,
): void {
	const computeRef = useRef(compute);
	computeRef.current = compute;
	useLayoutEffect(() => {
		if (!active) return;
		const tick = () => {
			const activity = computeRef.current();
			if (activity === null) store.reset();
			else store.publish(activity);
		};
		tick();
		const id = window.setInterval(tick, 1000);
		return () => {
			window.clearInterval(id);
			store.reset();
		};
	}, [active, store]);
	const firstKickRef = useRef(true);
	useLayoutEffect(() => {
		// The start tick above already covers the first render.
		if (firstKickRef.current) {
			firstKickRef.current = false;
			return;
		}
		if (!active) return;
		const activity = computeRef.current();
		if (activity === null) store.reset();
		else store.publish(activity);
		// Only a kick re-runs this; the start tick owns `active`, and
		// `store` is stable for the panel's life.
	}, [kick]);
}
