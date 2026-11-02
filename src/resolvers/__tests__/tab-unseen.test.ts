/**
 * Tab Attention States — the unseen-result flag ([[Tab Attention States]]
 * § Unseen flag). A finished turn the user hasn't looked at marks the tab so
 * the strip can show a tick; looking at the tab, or sending again, clears it.
 *
 * Seam: the pure reducer and viewed gate that ChatPanel calls (R2). Outcomes
 * are the next flag value (R3). Expected values are literals (R5).
 */
import { describe, expect, it } from "vitest";
import { isBeingViewed, nextTabUnseen } from "../tab-unseen";
import type { TabUnseen } from "../../types/tab";
import type { TurnStopKind } from "../../types/session";

const FLAGS: TabUnseen[] = [null, { kind: "done" }, { kind: "stopped" }];

describe("nextTabUnseen — turnEnded while not viewed", () => {
	const cases: Array<[TurnStopKind | "failed", TabUnseen]> = [
		["endTurn", { kind: "done" }],
		["maxTokens", { kind: "stopped" }],
		["maxRequests", { kind: "stopped" }],
		["refusal", { kind: "stopped" }],
		["failed", { kind: "stopped" }],
		["unknown", { kind: "done" }],
		["cancelled", null],
	];
	for (const [outcome, want] of cases) {
		for (const prev of FLAGS) {
			it(`${outcome} from ${prev?.kind ?? "none"} → ${want?.kind ?? "none"}`, () => {
				expect(
					nextTabUnseen(prev, { type: "turnEnded", outcome, viewed: false }),
				).toEqual(want);
			});
		}
	}
});

describe("nextTabUnseen — turnEnded while viewed never sets the flag", () => {
	for (const outcome of ["endTurn", "maxTokens", "failed", "unknown"] as const) {
		it(outcome, () => {
			expect(
				nextTabUnseen(null, { type: "turnEnded", outcome, viewed: true }),
			).toBeNull();
		});
	}
});

describe("nextTabUnseen — viewed and sendStarted clear the flag", () => {
	for (const type of ["viewed", "sendStarted"] as const) {
		for (const prev of FLAGS) {
			it(`${type} from ${prev?.kind ?? "none"} → none`, () => {
				expect(nextTabUnseen(prev, { type })).toBeNull();
			});
		}
	}
});

describe("isBeingViewed — all four signals must hold", () => {
	for (const isActiveTab of [true, false]) {
		for (const isLeafShown of [true, false]) {
			for (const visibilityState of ["visible", "hidden"] as const) {
				for (const hasFocus of [true, false]) {
					const want =
						isActiveTab && isLeafShown && visibilityState === "visible" && hasFocus;
					it(`active=${isActiveTab} shown=${isLeafShown} ${visibilityState} focus=${hasFocus} → ${want}`, () => {
						expect(
							isBeingViewed({ isActiveTab, isLeafShown, visibilityState, hasFocus }),
						).toBe(want);
					});
				}
			}
		}
	}
});
