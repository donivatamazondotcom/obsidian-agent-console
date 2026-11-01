/**
 * `useTabSessionState` — per-tab session state machine for
 * [[ACP Tab Persistence Across Restarts]] § Tab Session State Machine.
 *
 * Six-state machine driving three UI surfaces from one source of truth
 * (Decision #11): tab icon, send button, and header all read from the
 * `state` returned here. Consumers (`useLazySession` in Slice 3, the
 * agent-message handler, the permission UI) call named transition
 * methods in response to ACP events.
 *
 * State table (per spec):
 *
 *     idle         — Tab open, no session, composer empty/unfocused
 *     connecting   — Session acquisition in flight (session/new or session/load)
 *     ready        — Session live, idle
 *     busy         — Agent is processing a prompt
 *     permission   — Agent waiting on a permission decision
 *     error        — Acquisition failed (after replay-fallback also failed),
 *                    OR initialize never completed (agent process not running)
 *     released     — Process released after an hour idle (I209). Session id
 *                    kept; the next keystroke or send reconnects.
 *
 * Transition methods enforce intent at the type level. Strict transition
 * gating (rejecting illegal moves like `endBusy` from `idle`) is NOT
 * enforced for the original six states — Slice 3 wires the real lifecycle
 * and validates sequences at the boundary.
 *
 * `released` (I209) is the exception and is gated here: RELEASE is legal
 * only from `ready`, and a released tab leaves only by START_CONNECT
 * (keystroke / send) or RESET (new chat / agent switch). Busy, permission and
 * connect-result actions are rejected, so a late event from the released
 * process can't make the tab look live.
 *
 * Implementation note: `useReducer` is used (not `useState` + setters)
 * so that transition method identities are stable across renders. This
 * matters because consumers will pass these methods through props /
 * callbacks / effect dependencies; unstable identities would cascade
 * into per-render effect re-fires across the chat panel — exactly the
 * unstable-references class that [[ACP Scroll Architecture Rework]]
 * spent months untangling.
 */

import { useCallback, useReducer } from "react";

// ============================================================================
// Public types
// ============================================================================

// TabSessionState moved to types/tab.ts (utils-leaf refactor, G2); re-exported
// so ui consumers keep their import path. resolvers/services import types/tab.
import type { TabSessionState } from "../types/tab";
export type { TabSessionState } from "../types/tab";

export interface UseTabSessionStateOptions {
	/** Starting state. Defaults to `"idle"`. */
	initialState?: TabSessionState;
}

export interface TabSessionStateApi {
	/** Current state. Single source of truth read by tab icon, send button, and header. */
	state: TabSessionState;

	/** Begin acquiring a session (session/new or session/load). idle/error → connecting. */
	startConnect: () => void;

	/** Session successfully created/loaded. connecting → ready. */
	connectSucceeded: () => void;

	/** Session acquisition failed (after replay fallback also failed). connecting → error. */
	connectFailed: () => void;

	/** Agent began processing a prompt. ready → busy. */
	startBusy: () => void;

	/** Agent response complete. busy → ready. */
	endBusy: () => void;

	/** Permission decision required. ready/busy → permission. */
	requestPermission: () => void;

	/** Permission decision made. permission → ready. */
	resolvePermission: () => void;

	/** Force back to idle (e.g., new chat / reset). Any state → idle. */
	reset: () => void;

	/** Idle release (I209). ready → released; every other state unchanged. */
	release: () => void;
}

// ============================================================================
// Reducer
// ============================================================================

type Action =
	| { type: "START_CONNECT" }
	| { type: "CONNECT_SUCCEEDED" }
	| { type: "CONNECT_FAILED" }
	| { type: "START_BUSY" }
	| { type: "END_BUSY" }
	| { type: "REQUEST_PERMISSION" }
	| { type: "RESOLVE_PERMISSION" }
	| { type: "RESET" }
	| { type: "RELEASE" };

function reducer(state: TabSessionState, action: Action): TabSessionState {
	// I209 gates: RELEASE only from ready; released accepts only connect / reset.
	if (action.type === "RELEASE") return state === "ready" ? "released" : state;
	if (
		state === "released" &&
		action.type !== "START_CONNECT" &&
		action.type !== "RESET"
	) {
		return state;
	}
	switch (action.type) {
		case "START_CONNECT":
			return "connecting";
		case "CONNECT_SUCCEEDED":
			return "ready";
		case "CONNECT_FAILED":
			return "error";
		case "START_BUSY":
			return "busy";
		case "END_BUSY":
			return "ready";
		case "REQUEST_PERMISSION":
			return "permission";
		case "RESOLVE_PERMISSION":
			return "ready";
		case "RESET":
			return "idle";
	}
}

// ============================================================================
// Hook
// ============================================================================

export function useTabSessionState(
	options: UseTabSessionStateOptions = {},
): TabSessionStateApi {
	const initial: TabSessionState = options.initialState ?? "idle";
	const [state, dispatch] = useReducer(reducer, initial);

	// All transition methods have stable identity across renders because
	// `dispatch` is referentially stable (React guarantees this) and the
	// useCallback wrappers below have empty dependency arrays.
	const startConnect = useCallback(
		() => dispatch({ type: "START_CONNECT" }),
		[],
	);
	const connectSucceeded = useCallback(
		() => dispatch({ type: "CONNECT_SUCCEEDED" }),
		[],
	);
	const connectFailed = useCallback(
		() => dispatch({ type: "CONNECT_FAILED" }),
		[],
	);
	const startBusy = useCallback(() => dispatch({ type: "START_BUSY" }), []);
	const endBusy = useCallback(() => dispatch({ type: "END_BUSY" }), []);
	const requestPermission = useCallback(
		() => dispatch({ type: "REQUEST_PERMISSION" }),
		[],
	);
	const resolvePermission = useCallback(
		() => dispatch({ type: "RESOLVE_PERMISSION" }),
		[],
	);
	const reset = useCallback(() => dispatch({ type: "RESET" }), []);
	const release = useCallback(() => dispatch({ type: "RELEASE" }), []);

	return {
		state,
		startConnect,
		connectSucceeded,
		connectFailed,
		startBusy,
		endBusy,
		requestPermission,
		resolvePermission,
		reset,
		release,
	};
}
