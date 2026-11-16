/**
 * I376: the React binding for the per-panel A2UI turn store
 * (`services/a2ui/turn-store.ts`). ChatPanel provides its store; a surface
 * host reads one value with `useA2uiTurnSlice`, so it re-renders only when
 * that value changes. Same pattern as `ui/turn-activity-context.ts`.
 */
import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import {
	createA2uiTurnStore,
	type A2uiTurnState,
	type A2uiTurnStore,
} from "../services/a2ui/turn-store";
import { getLogger } from "../utils/logger";

/**
 * Used only outside a provider. Fail-closed: "sending" refuses every click,
 * so a surface rendered without its panel can never send. Hosts mount only
 * under ChatPanel's provider, so this is a wiring mistake, logged once.
 */
const UNPROVIDED_STORE: A2uiTurnStore = createA2uiTurnStore({
	isSending: true,
	isQueued: false,
	isRestoringSession: false,
	sessionState: "ready",
	heldSurfaceId: null,
});

let warnedUnprovided = false;

export const A2uiTurnStoreContext = createContext<A2uiTurnStore>(UNPROVIDED_STORE);

/** One value from the panel's turn store; re-renders only when it changes. */
export function useA2uiTurnSlice<T>(selector: (state: A2uiTurnState) => T): T {
	const store = useContext(A2uiTurnStoreContext);
	if (store === UNPROVIDED_STORE && !warnedUnprovided) {
		warnedUnprovided = true;
		getLogger().debug(
			"a2ui surface rendered outside an A2uiTurnStoreContext provider; actions stay disabled",
		);
	}
	const getSnapshot = useCallback(() => selector(store.getSnapshot()), [store, selector]);
	return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
