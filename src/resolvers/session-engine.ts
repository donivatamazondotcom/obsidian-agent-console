/**
 * Pure resolvers for D2: each chat remembers the Kiro engine it ran on
 * ([[Kiro CLI V3 Support]] § Decisions, 2026-11-01 D2).
 *
 * - `parseSessionEngine` is the ONE validator for a stored engine. It runs on
 *   write (SessionStore, tab persistence), on read (the restored-tab map and
 *   the session-record lookup) and in the lifecycle harness. A missing value
 *   is unknown; a present but invalid one is dropped and reported, never
 *   coerced.
 * - `resolveStoredSessionEngine` picks which stored value a restore uses: the
 *   session record first (written per turn), then the tab, then unknown.
 * - `decideEngineRestore` decides whether to load the session or start fresh.
 *   Live check (2026-11-01): a V2 chat loads on V3, but a V3 chat fails on V2
 *   with `Internal error`. So a V3 chat on V2 starts fresh without sending its
 *   id; everything else loads, unknown (old data) included.
 *
 * The engine value follows I235: `"v2"` for every launch that is not V3,
 * non-Kiro agents included, so a non-Kiro chat always loads.
 */

/** Engine a chat ran on. Same union as `InitializeResult.kiroEngine`. */
export type SessionEngine = "v2" | "v3";

/** Why a restored chat started a new session instead of loading its own. */
export type SessionFallbackReason = "unavailable" | "engine-changed";

/**
 * Parse a stored engine. `undefined`/`null` → unknown (silent). Anything else
 * that isn't `"v2"` / `"v3"` → unknown, and `onInvalid` is called with it so
 * the caller can log it.
 */
export function parseSessionEngine(
	value: unknown,
	onInvalid?: (raw: unknown) => void,
): SessionEngine | undefined {
	if (value === "v2" || value === "v3") return value;
	if (value !== undefined && value !== null) onInvalid?.(value);
	return undefined;
}

/** The stored engine a restore should use: record, then tab, then unknown. */
export function resolveStoredSessionEngine(input: {
	recordEngine: SessionEngine | undefined;
	tabEngine: SessionEngine | undefined;
}): SessionEngine | undefined {
	return input.recordEngine ?? input.tabEngine;
}

export type EngineRestoreDecision =
	| { kind: "load" }
	| {
			kind: "start-fresh";
			reason: "engine-changed";
			from: "v3";
			to: "v2";
	  };

/**
 * Load the stored session, or start fresh because the running engine can't
 * open it. Total: unknown on either side loads (today's behavior).
 */
export function decideEngineRestore(input: {
	stored: SessionEngine | undefined;
	running: SessionEngine | undefined;
}): EngineRestoreDecision {
	if (input.stored === "v3" && input.running === "v2") {
		return { kind: "start-fresh", reason: "engine-changed", from: "v3", to: "v2" };
	}
	return { kind: "load" };
}
