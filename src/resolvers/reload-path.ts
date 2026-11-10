/**
 * Which path a soft reload (↻ / `reload-session`) takes (I251).
 *
 * - `busy`: the lazy owner is already acquiring (a first send, reconnect or
 *   another reload). One acquisition at a time; nothing starts.
 * - `reload`: a session is bound. Tear down, resume the same session, or fall
 *   back to a new one (I229, `reloadSessionFlow`).
 * - `connect`: no session is bound (a chat restored from history or at
 *   startup, a released tab, a fresh tab, a failed first connect). Restart the
 *   agent and run the same acquisition a first send runs: fork, then the kept
 *   id, then a new session.
 *
 * Decided from the lazy owner's state only, never the agent id. A pending
 * typing debounce doesn't count as in flight: the reload cancels it.
 */
export type ReloadPath =
	| { kind: "busy" }
	| { kind: "reload" }
	| { kind: "connect" };

export interface ReloadPathInput {
	/** The lazy owner has a bound session id (a failed reload unbinds it, I318). */
	hasBoundSession: boolean;
	/** An acquisition is running in the lazy owner. */
	acquisitionInFlight: boolean;
}

export function decideReloadPath(input: ReloadPathInput): ReloadPath {
	if (input.acquisitionInFlight) return { kind: "busy" };
	if (input.hasBoundSession) return { kind: "reload" };
	return { kind: "connect" };
}
