/**
 * D2 — each chat remembers its Kiro engine ([[Kiro CLI V3 Support]] §
 * Decisions, 2026-11-01 D2).
 *
 * Truth tables for the three pure pieces: the one validator
 * (`parseSessionEngine`), the stored-value precedence
 * (`resolveStoredSessionEngine`) and the restore decision
 * (`decideEngineRestore`). Literals only (R5).
 */
import { describe, expect, it, vi } from "vitest";
import {
	decideEngineRestore,
	parseSessionEngine,
	resolveStoredSessionEngine,
} from "../session-engine";

describe("parseSessionEngine (the one validator)", () => {
	it("accepts the two engines", () => {
		expect(parseSessionEngine("v2")).toBe("v2");
		expect(parseSessionEngine("v3")).toBe("v3");
	});

	it("reads a missing value as unknown without reporting it", () => {
		const onInvalid = vi.fn();
		expect(parseSessionEngine(undefined, onInvalid)).toBeUndefined();
		expect(parseSessionEngine(null, onInvalid)).toBeUndefined();
		expect(onInvalid).not.toHaveBeenCalled();
	});

	it("drops and reports a present but invalid value, never coerces", () => {
		const onInvalid = vi.fn();
		expect(parseSessionEngine("V3", onInvalid)).toBeUndefined();
		expect(parseSessionEngine("default", onInvalid)).toBeUndefined();
		expect(parseSessionEngine(3, onInvalid)).toBeUndefined();
		expect(parseSessionEngine("", onInvalid)).toBeUndefined();
		expect(onInvalid.mock.calls).toEqual([["V3"], ["default"], [3], [""]]);
	});
});

describe("resolveStoredSessionEngine", () => {
	it("prefers the session record (written per turn)", () => {
		expect(
			resolveStoredSessionEngine({ recordEngine: "v2", tabEngine: "v3" }),
		).toBe("v2");
	});

	it("falls back to the tab when the record has none", () => {
		expect(
			resolveStoredSessionEngine({ recordEngine: undefined, tabEngine: "v3" }),
		).toBe("v3");
	});

	it("is unknown when neither has one (old data)", () => {
		expect(
			resolveStoredSessionEngine({
				recordEngine: undefined,
				tabEngine: undefined,
			}),
		).toBeUndefined();
	});
});

describe("decideEngineRestore", () => {
	it("starts fresh when a V3 chat is reopened on V2", () => {
		expect(decideEngineRestore({ stored: "v3", running: "v2" })).toEqual({
			kind: "start-fresh",
			reason: "engine-changed",
			from: "v3",
			to: "v2",
		});
	});

	it.each([
		["v2", "v3"],
		["v2", "v2"],
		["v3", "v3"],
		[undefined, "v2"],
		[undefined, "v3"],
		["v3", undefined],
		[undefined, undefined],
	] as const)("loads for stored %s on running %s", (stored, running) => {
		expect(decideEngineRestore({ stored, running })).toEqual({ kind: "load" });
	});
});
