/**
 * Truth-table test for `deriveHeaderSlot` — the single pure resolver that
 * decides the header's secondary-slot display: show the model name, a
 * "Connecting…" placeholder, an idle ("Not connected") placeholder, or
 * nothing.
 *
 * Written test-first (RED before the resolver exists). The slot used to be
 * three overlapping inline booleans in ChatHeader.tsx (showModel /
 * showConnectingPlaceholder / showIdlePlaceholder). Two of the 8 cells are the
 * regression guards this resolver consolidates:
 *   - I80: ready + no model (e.g. Claude Code, which never sends
 *     `session/models`) must resolve to "empty" — NOT "connecting". The bug
 *     was the placeholder keying on `model == null` instead of the genuine
 *     `isConnecting` signal, so the header was stuck on "Connecting…" forever.
 *   - I40: an idle (lazy, not-yet-connected) tab must resolve to "idle"
 *     ("Not connected"), never "connecting".
 *
 * Exhaustive over the full input cube: model ∈ {null, "x"} × isLazyIdle ∈
 * {false, true} × isConnecting ∈ {false, true} = 8 rows. A present model wins
 * over every flag, so illegal combinations (e.g. "connecting while a model is
 * present") are unrepresentable in the output rather than left for the next
 * reader to re-derive.
 */
import { describe, it, expect } from "vitest";
import {
	deriveHeaderSlot,
	type HeaderSlotInput,
	type HeaderSlot,
} from "../../resolvers/header-slot";

interface Row {
	name: string;
	input: HeaderSlotInput;
	expected: HeaderSlot;
	guard?: string;
}

const ROWS: Row[] = [
	{
		name: "no model, not idle, not connecting → empty",
		input: { model: null, isLazyIdle: false, isConnecting: false },
		expected: { kind: "empty" },
		guard: "I80 (ready + no model, e.g. Claude Code) — must NOT be connecting",
	},
	{
		name: "no model, not idle, connecting → connecting",
		input: { model: null, isLazyIdle: false, isConnecting: true },
		expected: { kind: "connecting" },
	},
	{
		name: "no model, idle, not connecting → idle",
		input: { model: null, isLazyIdle: true, isConnecting: false },
		expected: { kind: "idle" },
		guard: "I40 (idle tab) — must NOT be connecting",
	},
	{
		name: "no model, idle, connecting → idle (idle wins over connecting)",
		input: { model: null, isLazyIdle: true, isConnecting: true },
		expected: { kind: "idle" },
	},
	{
		name: "model present, not idle, not connecting → model",
		input: { model: "claude-opus-4.7", isLazyIdle: false, isConnecting: false },
		expected: { kind: "model", model: "claude-opus-4.7" },
	},
	{
		name: "model present, not idle, connecting → model (illegal combo collapses to model)",
		input: { model: "claude-opus-4.7", isLazyIdle: false, isConnecting: true },
		expected: { kind: "model", model: "claude-opus-4.7" },
	},
	{
		name: "model present, idle, not connecting → model",
		input: { model: "claude-opus-4.7", isLazyIdle: true, isConnecting: false },
		expected: { kind: "model", model: "claude-opus-4.7" },
	},
	{
		name: "model present, idle, connecting → model",
		input: { model: "claude-opus-4.7", isLazyIdle: true, isConnecting: true },
		expected: { kind: "model", model: "claude-opus-4.7" },
	},
];

describe("deriveHeaderSlot — exhaustive 8-row truth table", () => {
	it("covers the full input cube (no row missing or duplicated)", () => {
		expect(ROWS).toHaveLength(8);
		const seen = new Set(
			ROWS.map(
				(r) =>
					`${r.input.model === null ? "null" : "model"}|${r.input.isLazyIdle}|${r.input.isConnecting}`,
			),
		);
		expect(seen.size).toBe(8);
	});

	for (const row of ROWS) {
		it(`${row.name}${row.guard ? ` [${row.guard}]` : ""}`, () => {
			expect(deriveHeaderSlot(row.input)).toEqual(row.expected);
		});
	}
});
