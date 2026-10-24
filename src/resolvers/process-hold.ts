/**
 * Pure resolver: may this tab hold an agent process right now?
 *
 * One decision, one owner (I208, shared with I209's idle reap). Every caller
 * that spawns or keeps an agent subprocess for a tab must read this — never
 * re-derive "is active / is fresh" inline.
 *
 * - The active tab may hold a process (composer affordances: slash commands,
 *   capabilities, image paste ready before typing — Decision #10).
 * - A deliberately fresh tab, or a fork, may hold one: it acquires a session
 *   eagerly as soon as initialize supplies capabilities.
 * - A restored tab in the background defers: its transcript is served from
 *   local data (Connection-free reading), so it stays process-free until the
 *   user activates it or sends to it (the lazy path initializes on demand).
 *
 * Total and side-effect free. No React, no Obsidian.
 */
import type { TabOrigin } from "../types/tab";

export interface ProcessHoldInput {
	/** The tab is the visible tab in its view. */
	isActive: boolean;
	/** How the tab came to exist in this run. */
	origin: TabOrigin;
	/** The tab is a fork-in-new-tab that must branch from a source session. */
	hasForkSource: boolean;
}

export type ProcessHoldDecision =
	| { kind: "hold"; reason: "active" | "fresh" | "fork" }
	| { kind: "defer"; reason: "background-restored" };

export function decideProcessHold(input: ProcessHoldInput): ProcessHoldDecision {
	if (input.isActive) return { kind: "hold", reason: "active" };
	if (input.hasForkSource) return { kind: "hold", reason: "fork" };
	if (input.origin === "fresh") return { kind: "hold", reason: "fresh" };
	return { kind: "defer", reason: "background-restored" };
}
