/**
 * I209 — `decideProcessHold` gains `release` (spec § 1, § 6 test 1).
 *
 * Precedence: active → hold:active. Any busy signal → hold:busy. Live session
 * → release at or past IDLE_RELEASE_MS, else hold:warm with remainingMs. No
 * live session → the I208 spawn rules, unchanged.
 *
 * Expected values are literals (R5); the table is enumerated, not computed by
 * re-implementing the resolver.
 *
 * Spec: [[I209 Idle tabs never release their agent process]].
 */
import { describe, expect, it } from "vitest";
import {
	decideProcessHold,
	IDLE_RELEASE_MS,
	type BusySignal,
	type ProcessHoldInput,
} from "../process-hold";

const HOUR = 60 * 60_000;

function input(over: Partial<ProcessHoldInput> = {}): ProcessHoldInput {
	return {
		isActive: false,
		origin: "fresh",
		hasForkSource: false,
		liveSession: true,
		idleMs: 0,
		busy: [],
		...over,
	};
}

const ALL_SIGNALS: BusySignal[] = [
	"streaming",
	"permission",
	"queued",
	"acquiring",
	"history-loading",
	"ai-rename",
	"terminals",
	"draft",
];

describe("I209 decideProcessHold — release", () => {
	it("the threshold is a fixed hour", () => {
		expect(IDLE_RELEASE_MS).toBe(3_600_000);
	});

	it("releases a live background tab at the threshold", () => {
		expect(decideProcessHold(input({ idleMs: HOUR }))).toEqual({
			kind: "release",
			reason: "idle",
		});
	});

	it("releases just past the threshold", () => {
		expect(decideProcessHold(input({ idleMs: HOUR + 1 }))).toEqual({
			kind: "release",
			reason: "idle",
		});
	});

	it("holds warm just under the threshold, with the time left", () => {
		expect(decideProcessHold(input({ idleMs: HOUR - 1 }))).toEqual({
			kind: "hold",
			reason: "warm",
			remainingMs: 1,
		});
	});

	it("holds warm with the full hour left at zero idle", () => {
		expect(decideProcessHold(input({ idleMs: 0 }))).toEqual({
			kind: "hold",
			reason: "warm",
			remainingMs: 3_600_000,
		});
	});

	it("never releases the active tab, even long idle", () => {
		expect(
			decideProcessHold(input({ isActive: true, idleMs: 10 * HOUR })),
		).toEqual({ kind: "hold", reason: "active" });
	});

	it("active outranks busy", () => {
		expect(
			decideProcessHold(
				input({ isActive: true, busy: ["streaming"], idleMs: 10 * HOUR }),
			),
		).toEqual({ kind: "hold", reason: "active" });
	});

	it.each(ALL_SIGNALS)("busy signal %s alone holds past the threshold", (s) => {
		expect(
			decideProcessHold(input({ busy: [s], idleMs: 10 * HOUR })),
		).toEqual({ kind: "hold", reason: "busy", signal: s });
	});

	it.each(ALL_SIGNALS)("busy signal %s alone holds under the threshold", (s) => {
		expect(decideProcessHold(input({ busy: [s], idleMs: 1 }))).toEqual({
			kind: "hold",
			reason: "busy",
			signal: s,
		});
	});

	it("reports the first busy signal when several are present", () => {
		expect(
			decideProcessHold(
				input({ busy: ["queued", "draft"], idleMs: 10 * HOUR }),
			),
		).toEqual({ kind: "hold", reason: "busy", signal: "queued" });
	});

	it("busy holds a background tab with no live session too", () => {
		expect(
			decideProcessHold(
				input({ liveSession: false, origin: "restored", busy: ["acquiring"] }),
			),
		).toEqual({ kind: "hold", reason: "busy", signal: "acquiring" });
	});

	it("live session outranks fresh / fork spawn reasons", () => {
		expect(
			decideProcessHold(
				input({ hasForkSource: true, idleMs: 2 * HOUR }),
			),
		).toEqual({ kind: "release", reason: "idle" });
		expect(
			decideProcessHold(input({ origin: "restored", idleMs: 2 * HOUR })),
		).toEqual({ kind: "release", reason: "idle" });
	});

	describe("no live session → I208 spawn rules, unchanged", () => {
		const cases: Array<[boolean, "fresh" | "restored", boolean, string]> = [
			[true, "fresh", false, "hold:active"],
			[true, "restored", true, "hold:active"],
			[false, "fresh", true, "hold:fork"],
			[false, "restored", true, "hold:fork"],
			[false, "fresh", false, "hold:fresh"],
			[false, "restored", false, "defer:background-restored"],
		];
		it.each(cases)(
			"isActive=%s origin=%s fork=%s → %s (any idle time)",
			(isActive, origin, hasForkSource, expected) => {
				for (const idleMs of [0, HOUR, 10 * HOUR]) {
					const d = decideProcessHold(
						input({ isActive, origin, hasForkSource, liveSession: false, idleMs }),
					);
					expect(`${d.kind}:${d.reason}`).toBe(expected);
				}
			},
		);
	});
});
