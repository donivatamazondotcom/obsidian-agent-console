/**
 * Tab Attention States — ACP stop reasons normalized at the `acp/` edge so
 * nothing outside it sees the SDK's raw strings (anti-corruption boundary).
 * Literals in, literals out (R3, R5).
 */
import { describe, expect, it } from "vitest";
import { toTurnStopKind } from "../stop-kind";

describe("toTurnStopKind", () => {
	it.each([
		["end_turn", "endTurn"],
		["max_tokens", "maxTokens"],
		["max_turn_requests", "maxRequests"],
		["refusal", "refusal"],
		["cancelled", "cancelled"],
	])("maps %s → %s", (raw, kind) => {
		expect(toTurnStopKind(raw)).toBe(kind);
	});

	it.each([["something_new"], [undefined], [null], [42]])(
		"maps an unrecognized value (%s) → unknown",
		(raw) => {
			expect(toTurnStopKind(raw)).toBe("unknown");
		},
	);
});
