/**
 * Truth table for deriveAgentPickerOptions (landing "New chat with an agent"):
 * detection-gating, default-first ordering, and the show>1 gate.
 *
 * Fixture ids use the neutral `agent-` prefix so the no-internal-agent-ids
 * PR-time tripwire allowlists them (bare single-letter ids are not).
 */

import { describe, expect, it } from "vitest";
import { deriveAgentPickerOptions } from "../agent-picker-options";

const A = { id: "agent-a", displayName: "Alpha" };
const B = { id: "agent-b", displayName: "Beta" };
const C = { id: "agent-c", displayName: "Gamma" };

describe("deriveAgentPickerOptions", () => {
	it("gates to detected agents and puts the default first", () => {
		const r = deriveAgentPickerOptions({
			available: [A, B, C],
			detected: new Set(["agent-a", "agent-b"]),
			defaultAgentId: "agent-b",
		});
		expect(r.show).toBe(true);
		expect(r.options.map((o) => o.id)).toEqual(["agent-b", "agent-a"]); // default (b) first, then a; c gated out
		expect(r.options[0].isDefault).toBe(true);
		expect(r.options[1].isDefault).toBe(false);
	});

	it("hides the picker when only one agent is detected (composer default covers it)", () => {
		const r = deriveAgentPickerOptions({
			available: [A, B],
			detected: new Set(["agent-a"]),
			defaultAgentId: "agent-a",
		});
		expect(r.show).toBe(false);
		expect(r.options.map((o) => o.id)).toEqual(["agent-a"]);
	});

	it("hides the picker when no agent is detected (empty)", () => {
		const r = deriveAgentPickerOptions({
			available: [A, B],
			detected: new Set(),
			defaultAgentId: "agent-a",
		});
		expect(r.show).toBe(false);
		expect(r.options).toEqual([]);
	});

	it("optimistically offers all agents while detection is unresolved (null)", () => {
		const r = deriveAgentPickerOptions({
			available: [A, B, C],
			detected: null,
			defaultAgentId: "agent-c",
		});
		expect(r.show).toBe(true);
		expect(r.options.map((o) => o.id)).toEqual([
			"agent-c",
			"agent-a",
			"agent-b",
		]); // default first, rest in order
	});

	it("preserves available order among non-defaults", () => {
		const r = deriveAgentPickerOptions({
			available: [C, B, A],
			detected: new Set(["agent-a", "agent-b", "agent-c"]),
			defaultAgentId: "agent-a",
		});
		expect(r.options.map((o) => o.id)).toEqual([
			"agent-a",
			"agent-c",
			"agent-b",
		]); // default a first, then C,B in available order
	});

	it("does not require the default to be detected (default may be gated out)", () => {
		const r = deriveAgentPickerOptions({
			available: [A, B],
			detected: new Set(["agent-b"]),
			defaultAgentId: "agent-a",
		});
		expect(r.show).toBe(false); // only b survives
		expect(r.options.map((o) => o.id)).toEqual(["agent-b"]);
		expect(r.options[0].isDefault).toBe(false);
	});
});
