import { describe, it, expect } from "vitest";
import { readSessionModes, lookupByIdOrName } from "../session-modes";
import type { SessionConfigOption } from "../../types/session";

/** [[Agent Console Quick Prompt Agent and Mode]] T05. */

const modeOption = (
	currentValue: string,
	options: SessionConfigOption["options"],
	over: Partial<SessionConfigOption> = {},
): SessionConfigOption => ({
	id: "mode",
	name: "Mode",
	category: "mode",
	type: "select",
	currentValue,
	options,
	...over,
});

describe("readSessionModes", () => {
	it("reads legacy modes with names", () => {
		expect(
			readSessionModes({
				modes: {
					currentModeId: "plan",
					availableModes: [
						{ id: "default", name: "Default" },
						{ id: "plan", name: "Plan Mode" },
					],
				},
			}),
		).toEqual({
			current: { id: "plan", name: "Plan Mode" },
			offered: [
				{ id: "default", name: "Default" },
				{ id: "plan", name: "Plan Mode" },
			],
		});
	});

	it("reads the mode config option (Kiro: value vibe shows as Default), incl. groups", () => {
		expect(
			readSessionModes({
				configOptions: [
					modeOption("vibe", [
						{
							group: "g",
							name: "G",
							options: [
								{ value: "vibe", name: "Default" },
								{ value: "my-agent", name: "my-agent" },
							],
						},
					]),
				],
			}),
		).toEqual({
			current: { id: "vibe", name: "Default" },
			offered: [
				{ id: "vibe", name: "Default" },
				{ id: "my-agent", name: "my-agent" },
			],
		});
	});

	it("finds the mode option by id even without a category", () => {
		expect(
			readSessionModes({
				configOptions: [
					modeOption("a", [{ value: "a", name: "A" }], { category: null }),
				],
			})?.current.id,
		).toBe("a");
	});

	it("prefers the config option over legacy modes", () => {
		expect(
			readSessionModes({
				modes: {
					currentModeId: "legacy",
					availableModes: [{ id: "legacy", name: "L" }],
				},
				configOptions: [modeOption("new", [{ value: "new", name: "N" }])],
			})?.current,
		).toEqual({ id: "new", name: "N" });
	});

	it("falls back to the id when the current value is not in the list", () => {
		expect(
			readSessionModes({
				configOptions: [modeOption("ghost", [{ value: "a", name: "A" }])],
			})?.current,
		).toEqual({ id: "ghost", name: "ghost" });
	});

	it("returns null when there are no modes", () => {
		expect(readSessionModes({})).toBeNull();
		expect(
			readSessionModes({
				configOptions: [
					modeOption("m", [{ value: "m", name: "M" }], {
						id: "model",
						category: "model",
					}),
				],
			}),
		).toBeNull();
	});
});

describe("lookupByIdOrName", () => {
	const KIRO = [
		{ id: "vibe", name: "Default" },
		{ id: "spec", name: "Spec" },
		{ id: "quick-spec", name: "Quick Spec" },
		{ id: "my-agent", name: "my-agent" },
	];

	it("matches an exact id", () => {
		expect(lookupByIdOrName("vibe", KIRO)).toBe("vibe");
	});

	it("matches the display name the dropdown shows", () => {
		expect(lookupByIdOrName("Default", KIRO)).toBe("vibe");
		expect(lookupByIdOrName("Quick Spec", KIRO)).toBe("quick-spec");
	});

	it("matches a display name case-insensitively", () => {
		expect(lookupByIdOrName("quick spec", KIRO)).toBe("quick-spec");
	});

	it("prefers an id over another item's name", () => {
		const items = [
			{ id: "plan", name: "Planner" },
			{ id: "x", name: "plan" },
		];
		expect(lookupByIdOrName("plan", items)).toBe("plan");
	});

	it("returns null for no match", () => {
		expect(lookupByIdOrName("yolo", KIRO)).toBeNull();
	});

	it("returns null when a name is ambiguous — never guesses", () => {
		const items = [
			{ id: "a", name: "Review" },
			{ id: "b", name: "review" },
		];
		expect(lookupByIdOrName("REVIEW", items)).toBeNull();
		expect(
			lookupByIdOrName("Same", [
				{ id: "a", name: "Same" },
				{ id: "b", name: "Same" },
			]),
		).toBeNull();
	});
});
