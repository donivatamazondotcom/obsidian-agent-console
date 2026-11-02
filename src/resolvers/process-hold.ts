/**
 * Pure resolver: may this tab hold an agent process right now?
 *
 * One decision, one owner (I208 spawn rules, I209 idle release). Every caller
 * that spawns, keeps or releases an agent subprocess for a tab must read this
 * — never re-derive "is active / is fresh / is idle" inline.
 *
 * Precedence:
 * 1. The active tab holds (composer affordances: slash commands,
 *    capabilities, image paste ready before typing — Decision #10). The
 *    active tab is never released.
 * 2. Anything in progress holds (`busy`, first signal reported).
 * 3. A tab with a live session (process up AND a session bound) is released
 *    once it has been idle for {@link IDLE_RELEASE_MS}; until then it holds
 *    warm and reports the time left, so the caller can arm one timer.
 * 4. No live session → the I208 spawn rules: a fresh tab or a fork may hold
 *    one; a restored tab in the background defers (Connection-free reading —
 *    its transcript is local, so it stays process-free until activated or
 *    sent to).
 *
 * `release` never spawns: `useEagerInitialize` acts only on `kind === "hold"`.
 *
 * Total and side-effect free. No React, no Obsidian.
 */
import type { TabOrigin } from "../types/tab";

/** Fixed idle threshold: one hour, no setting (I209 spec decision). */
export const IDLE_RELEASE_MS = 60 * 60_000;

/** Work in progress that keeps a background tab's process alive. */
export type BusySignal =
	| "streaming"
	| "permission"
	| "queued"
	| "acquiring"
	| "history-loading"
	| "ai-rename"
	| "terminals"
	| "draft";

export interface ProcessHoldInput {
	/** The tab is the visible tab in its view. */
	isActive: boolean;
	/** How the tab came to exist in this run. */
	origin: TabOrigin;
	/** The tab is a fork-in-new-tab that must branch from a source session. */
	hasForkSource: boolean;
	/** The agent process is up AND a session is bound to this tab. */
	liveSession: boolean;
	/** Time since max(last activity, last deactivation). */
	idleMs: number;
	/** Work in progress. Empty = nothing in progress. */
	busy: readonly BusySignal[];
	/**
	 * Debug-only override of {@link IDLE_RELEASE_MS} for smoke tests (honored
	 * by the caller only in debug mode — never a setting). A missing, zero,
	 * negative or non-finite value means the fixed hour.
	 */
	thresholdMs?: number;
}

export type ProcessHoldDecision =
	| { kind: "hold"; reason: "active" | "fresh" | "fork" }
	| { kind: "hold"; reason: "busy"; signal: BusySignal }
	| { kind: "hold"; reason: "warm"; remainingMs: number }
	| { kind: "defer"; reason: "background-restored" }
	| { kind: "release"; reason: "idle" };

export function decideProcessHold(input: ProcessHoldInput): ProcessHoldDecision {
	if (input.isActive) return { kind: "hold", reason: "active" };
	const signal = input.busy[0];
	if (signal !== undefined) return { kind: "hold", reason: "busy", signal };
	if (input.liveSession) {
		const o = input.thresholdMs;
		const threshold =
			o !== undefined && Number.isFinite(o) && o > 0 ? o : IDLE_RELEASE_MS;
		if (input.idleMs >= threshold) return { kind: "release", reason: "idle" };
		return {
			kind: "hold",
			reason: "warm",
			remainingMs: threshold - input.idleMs,
		};
	}
	if (input.hasForkSource) return { kind: "hold", reason: "fork" };
	if (input.origin === "fresh") return { kind: "hold", reason: "fresh" };
	return { kind: "defer", reason: "background-restored" };
}
