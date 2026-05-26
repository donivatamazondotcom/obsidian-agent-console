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
 *
 * Transition methods enforce intent at the type level. Strict transition
 * gating (rejecting illegal moves like `endBusy` from `idle`) is NOT
 * enforced here — Slice 3 wires the real lifecycle and validates
 * sequences at the boundary; this hook only ensures each method mutates
 * state correctly when called.
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

export type TabSessionState =
	| "idle"
	| "connecting"
	| "ready"
	| "busy"
	| "permission"
	| "error";

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
	| { type: "RESET" };

function reducer(_state: TabSessionState, action: Action): TabSessionState {
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
	};
}
