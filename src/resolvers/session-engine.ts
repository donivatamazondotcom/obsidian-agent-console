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
 * - `launchedEngine` and `resolveKeptKiroEngine` decide which engine the
 *   session and the tab hold once a process is known (I250).
 *
 * The engine value follows I235 and I250: `"v3"` for a V3 launch, `"v2"` for
 * any other kiro-cli launch, and undefined when the process isn't kiro-cli.
 * A missing running engine is unknown, so a non-Kiro chat always loads.
 */

import type { KiroEngineFallback } from "../types/session";

/** Engine a chat ran on. Same union as `InitializeResult.kiroEngine`. */
export type SessionEngine = "v2" | "v3";

/** Why a restored chat started a new session instead of loading its own. */
/**
 * Why a stored V3 chat can't load on the running V2: the agent was set to V2
 * (`engine-changed`, D2), or the agent follows the Default engine and the
 * kiro-cli is too old for V3 (`engine-changed-old-cli`, I302).
 */
export type EngineChangeReason = "engine-changed" | "engine-changed-old-cli";

export type SessionFallbackReason = "unavailable" | EngineChangeReason;

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

/**
 * The engine a session copies from the agent client's init result. An init
 * result is the truth for its process: its `undefined` means "no engine"
 * (not kiro-cli) and replaces an older value. Only with no init result does
 * the session keep what it had (I250).
 *
 * Scope: `AcpClient.getInitializeResult()` returns the last successful
 * initialize and is never cleared on disconnect or a failed start. Every
 * caller runs right after a successful initialize, so the result belongs to
 * the current process; a caller outside that window must not use this.
 */
export function launchedEngine(
	init: { kiroEngine?: SessionEngine } | null | undefined,
	prev: { kiroEngine?: SessionEngine },
): SessionEngine | undefined {
	return init ? init.kiroEngine : prev.kiroEngine;
}

/**
 * Why the launched Kiro process runs V2 instead of its Default V3 (I302),
 * with `launchedEngine`'s rule: an init result is the truth for its process,
 * so a V3 init's undefined replaces an older "old-cli". Same scope note.
 */
export function launchedFallback(
	init: { kiroEngineFallback?: KiroEngineFallback } | null | undefined,
	prev: { kiroEngineFallback?: KiroEngineFallback },
): KiroEngineFallback | undefined {
	return init ? init.kiroEngineFallback : prev.kiroEngineFallback;
}

/**
 * The engine tab persistence keeps for this tab's session id. A live session
 * whose process is known (`kiroCli` set at initialize) replaces it with the
 * engine it launched with, including "none" for a non-Kiro agent. Otherwise
 * (no session yet, or not initialized) the restored or released value stays,
 * so the engine survives with a kept id (D2, I250).
 */
export function resolveKeptKiroEngine(
	kept: SessionEngine | undefined,
	live: {
		sessionId: string | null | undefined;
		kiroCli: boolean | undefined;
		kiroEngine: SessionEngine | undefined;
	},
): SessionEngine | undefined {
	if (!live.sessionId || live.kiroCli === undefined) return kept;
	return live.kiroEngine;
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
			reason: EngineChangeReason;
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
	/** Why the running process is V2, when it fell back (I302). */
	runningFallback?: KiroEngineFallback;
}): EngineRestoreDecision {
	if (input.stored === "v3" && input.running === "v2") {
		return {
			kind: "start-fresh",
			reason:
				input.runningFallback === "old-cli"
					? "engine-changed-old-cli"
					: "engine-changed",
			from: "v3",
			to: "v2",
		};
	}
	return { kind: "load" };
}
