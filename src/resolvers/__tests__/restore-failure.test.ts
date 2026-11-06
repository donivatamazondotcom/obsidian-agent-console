/**
 * I282: what a failed restore does, decided once.
 *
 * A row opened from the Agent view with no local record has nothing to carry
 * over. When the agent rejects its load (or loads it empty, I264), the tab
 * says the session is gone instead of falling back with a transcript claim.
 * When the agent never started, it says it couldn't connect. A row with a
 * local record, or a transcript on screen, keeps the I246 fallback.
 *
 * Pure truth table; literals only (R5).
 */
import { describe, expect, it } from "vitest";
import { decideRestoreFailure } from "../restore-failure";

describe("I282 decideRestoreFailure", () => {
	it("no record, nothing on screen: a rejected or empty load is gone", () => {
		for (const failure of ["rejected", "empty"] as const) {
			expect(
				decideRestoreFailure({
					hasLocalRecord: false,
					haveLocalHistory: false,
					failure,
				}),
			).toEqual({ kind: "gone" });
		}
	});

	it("no record, nothing on screen: an agent that never started, or a transport error, is a connect failure", () => {
		for (const failure of ["initialize", "transport", undefined] as const) {
			expect(
				decideRestoreFailure({
					hasLocalRecord: false,
					haveLocalHistory: false,
					failure,
				}),
			).toEqual({ kind: "connect-failed" });
		}
	});

	it("no record, nothing on screen: an engine change still falls back, never gone", () => {
		expect(
			decideRestoreFailure({
				hasLocalRecord: false,
				haveLocalHistory: false,
				failure: "engine-changed",
			}),
		).toEqual({ kind: "fallback", reason: "engine-changed" });
	});

	it("a local record keeps the I246 fallback for every failure", () => {
		for (const failure of [
			"rejected",
			"empty",
			"initialize",
			"transport",
			undefined,
		] as const) {
			expect(
				decideRestoreFailure({
					hasLocalRecord: true,
					haveLocalHistory: false,
					failure,
				}),
			).toEqual({ kind: "fallback", reason: "unavailable" });
		}
		expect(
			decideRestoreFailure({
				hasLocalRecord: true,
				haveLocalHistory: true,
				failure: "engine-changed",
			}),
		).toEqual({ kind: "fallback", reason: "engine-changed" });
	});

	it("no record but a replayed transcript on screen falls back with it", () => {
		expect(
			decideRestoreFailure({
				hasLocalRecord: false,
				haveLocalHistory: true,
				failure: "rejected",
			}),
		).toEqual({ kind: "fallback", reason: "unavailable" });
	});
});
