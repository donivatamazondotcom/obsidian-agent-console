/**
 * Idle release (I209): free a background tab's agent process after an hour
 * with nothing going on, and bring it back on the first keystroke or send.
 *
 * - `useIdleRelease` — WHEN. Reads `decideProcessHold` (the one owner) on
 *   every input change and arms one timer on `hold:warm`. No polling: when
 *   the timer fires it re-evaluates with the current clock, so a stale timer
 *   never releases. The activity clock resets on deactivation, on becoming
 *   live (reconnect ready), when work ends (busy signals go from some to
 *   none: turn end, permission resolved, queue flushed, draft cleared, rename
 *   done) and on explicit activity (`noteActivity`: keystroke, send).
 * - `runIdleRelease` — HOW, in order and awaited: re-check, flush the
 *   transcript save, re-check, lazy release (the UI goes `released` before
 *   the process dies), agent release (disconnect, wait for the tree to exit).
 * - `createReleaseGate` — a reconnect that starts during a release waits for
 *   the tree to exit. Kiro V2 rejects session/load while the old process
 *   still holds the session (I230), so "disconnect returned" is not enough.
 * - `useApplyAfterReconnect` — a model / mode / option pick on a released
 *   tab reconnects first, then applies the latest pick.
 *
 * Spec: [[I209 Idle tabs never release their agent process]].
 */
import { useCallback, useEffect, useRef } from "react";
import {
	decideProcessHold,
	type BusySignal,
	type ProcessHoldInput,
} from "../resolvers/process-hold";
import type { TabOrigin } from "../types/tab";

// ============================================================================
// useIdleRelease
// ============================================================================

export interface UseIdleReleaseArgs {
	isActive: boolean;
	origin: TabOrigin;
	hasForkSource: boolean;
	/** Agent process up AND a session bound to this tab. */
	liveSession: boolean;
	busy: readonly BusySignal[];
	/** Debug-only threshold override; see ProcessHoldInput.thresholdMs. */
	thresholdMs?: number;
	/**
	 * Run the release. `recheck()` re-reads the decision with the latest
	 * inputs; the callback must stop when it returns false.
	 */
	release: (recheck: () => boolean) => Promise<void>;
	/** Injectable clock for tests. Defaults to `Date.now`. */
	now?: () => number;
}

export interface UseIdleReleaseApi {
	/** Keystroke / send: restart the idle clock. Cheap: no re-render. */
	noteActivity: () => void;
}

export function useIdleRelease(args: UseIdleReleaseArgs): UseIdleReleaseApi {
	const argsRef = useRef(args);
	argsRef.current = args;
	const clock = useCallback(() => (argsRef.current.now ?? Date.now)(), []);

	const lastActivityRef = useRef<number | null>(null);
	if (lastActivityRef.current === null) lastActivityRef.current = clock();
	const releasingRef = useRef(false);
	const timerRef = useRef<number | null>(null);

	const busyKey = args.busy.join(",");
	const prevRef = useRef({
		isActive: args.isActive,
		liveSession: args.liveSession,
		busyKey,
	});

	const decide = useCallback(() => {
		const a = argsRef.current;
		const input: ProcessHoldInput = {
			isActive: a.isActive,
			origin: a.origin,
			hasForkSource: a.hasForkSource,
			liveSession: a.liveSession,
			busy: a.busy,
			idleMs: clock() - (lastActivityRef.current ?? clock()),
			thresholdMs: a.thresholdMs,
		};
		return decideProcessHold(input);
	}, [clock]);

	const clearTimer = useCallback(() => {
		if (timerRef.current !== null) {
			window.clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	// Evaluate: release now, or arm one timer for the time left.
	const evaluate = useCallback(() => {
		clearTimer();
		if (releasingRef.current) return;
		const d = decide();
		if (d.kind === "release") {
			releasingRef.current = true;
			void argsRef.current
				.release(() => decide().kind === "release")
				.catch(() => {
					// The caller logs; a failed release leaves the tab as it was.
				})
				.finally(() => {
					releasingRef.current = false;
				});
			return;
		}
		if (d.kind === "hold" && d.reason === "warm") {
			timerRef.current = window.setTimeout(() => {
				timerRef.current = null;
				evaluate();
			}, d.remainingMs);
		}
	}, [clearTimer, decide]);

	useEffect(() => {
		const prev = prevRef.current;
		const resetClock =
			prev.isActive !== args.isActive ||
			(!prev.liveSession && args.liveSession) ||
			(prev.busyKey !== "" && busyKey === "");
		if (resetClock) lastActivityRef.current = clock();
		prevRef.current = {
			isActive: args.isActive,
			liveSession: args.liveSession,
			busyKey,
		};
		evaluate();
	}, [
		args.isActive,
		args.liveSession,
		args.origin,
		args.hasForkSource,
		args.thresholdMs,
		busyKey,
		clock,
		evaluate,
	]);

	useEffect(() => clearTimer, [clearTimer]);

	const noteActivity = useCallback(() => {
		lastActivityRef.current = clock();
	}, [clock]);

	return { noteActivity };
}

// ============================================================================
// Release gate + sequence
// ============================================================================

export interface ReleaseGate {
	/** Resolves when no release is in flight (immediately if none). */
	wait: () => Promise<void>;
	/** Hold the gate until `until` settles (either way). */
	hold: (until: Promise<unknown>) => void;
}

export function createReleaseGate(): ReleaseGate {
	let current: Promise<void> = Promise.resolve();
	return {
		wait: () => current,
		hold: (until) => {
			current = until.then(
				() => undefined,
				() => undefined,
			);
		},
	};
}

export interface RunIdleReleaseArgs {
	recheck: () => boolean;
	/** Flush the debounced transcript save. */
	flush: () => Promise<void>;
	/** `useLazySession.release()`: ready → released; false = refused. */
	lazyRelease: () => boolean;
	/** `useAgentSession.releaseSession()`: disconnect, resolve on tree exit. */
	agentRelease: () => Promise<void>;
	gate: ReleaseGate;
}

/**
 * The release sequence (spec § 4). Returns true when the process was
 * released. Throws only if the agent release throws (the gate still opens).
 */
export async function runIdleRelease(args: RunIdleReleaseArgs): Promise<boolean> {
	if (!args.recheck()) return false;
	await args.flush();
	// The flush awaited: a send or keystroke may have landed meanwhile.
	if (!args.recheck()) return false;
	if (!args.lazyRelease()) return false;
	const releasing = args.agentRelease();
	args.gate.hold(releasing);
	await releasing;
	return true;
}

// ============================================================================
// useApplyAfterReconnect
// ============================================================================

export interface UseApplyAfterReconnectArgs {
	/** The tab is `released`. */
	released: boolean;
	/** A session is live and bound (the pick has something to apply to). */
	live: boolean;
	/** Start the kept-id reconnect. */
	reconnect: () => Promise<void>;
}

/**
 * Returns `run(apply)`: on a live tab, apply now. On a released tab, start the
 * reconnect and apply once the session is live. Only the latest pending pick
 * applies (a second pick before the reconnect lands replaces the first).
 */
export function useApplyAfterReconnect(
	args: UseApplyAfterReconnectArgs,
): (apply: () => void) => void {
	const pendingRef = useRef<(() => void) | null>(null);
	const argsRef = useRef(args);
	argsRef.current = args;

	useEffect(() => {
		if (!args.live || pendingRef.current === null) return;
		const apply = pendingRef.current;
		pendingRef.current = null;
		apply();
	}, [args.live]);

	return useCallback((apply: () => void) => {
		const a = argsRef.current;
		// Live, or a never-connected tab (unchanged behavior: the setter
		// no-ops without a session) → apply now. Only a released tab, or one
		// whose reconnect is already pending, waits.
		if (a.live || (!a.released && pendingRef.current === null)) {
			apply();
			return;
		}
		pendingRef.current = apply;
		if (a.released) void a.reconnect();
	}, []);
}
