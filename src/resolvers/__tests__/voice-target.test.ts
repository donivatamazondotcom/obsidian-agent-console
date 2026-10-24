/**
 * Truth table for `deriveVoiceTarget` — where a voice command goes.
 *
 * Inputs: the command, the focused tab, this vault's active recording (origin
 * tab), and whether another vault holds the recording lease. Cases are written
 * out by hand from spec § Multiple vaults and sessions — no expected value is
 * computed from the inputs.
 */
import { describe, it, expect } from "vitest";
import {
	deriveVoiceTarget,
	type VoiceTarget,
	type VoiceTargetInput,
} from "../voice-target";

const A1 = { leafId: "leaf-a", tabId: "tab-1" };
const A2 = { leafId: "leaf-a", tabId: "tab-2" };
const B1 = { leafId: "leaf-b", tabId: "tab-1" }; // same tabId, other leaf

interface Case {
	name: string;
	input: VoiceTargetInput;
	expected: VoiceTarget;
}

const CASES: Case[] = [
	// ── start ──────────────────────────────────────────────────────────
	{
		name: "start with nothing recording → start in the focused tab",
		input: { command: "start", focused: A1, local: null, remote: false },
		expected: { kind: "start", target: A1 },
	},
	{
		name: "start with no focused tab → nothing",
		input: { command: "start", focused: null, local: null, remote: false },
		expected: { kind: "none", reason: "no-focused-tab" },
	},
	{
		name: "start in the tab already recording → nothing",
		input: { command: "start", focused: A1, local: A1, remote: false },
		expected: { kind: "none", reason: "already-recording" },
	},
	{
		name: "start in another tab of this vault → hand off from that tab",
		input: { command: "start", focused: A2, local: A1, remote: false },
		expected: {
			kind: "hand-off",
			from: { scope: "local", origin: A1 },
			target: A2,
		},
	},
	{
		name: "same tabId in another leaf is a different tab → hand off",
		input: { command: "start", focused: B1, local: A1, remote: false },
		expected: {
			kind: "hand-off",
			from: { scope: "local", origin: A1 },
			target: B1,
		},
	},
	{
		name: "start while another vault records → hand off from that vault",
		input: { command: "start", focused: A1, local: null, remote: true },
		expected: { kind: "hand-off", from: { scope: "remote" }, target: A1 },
	},
	{
		name: "start with no focused tab while another vault records → nothing",
		input: { command: "start", focused: null, local: null, remote: true },
		expected: { kind: "none", reason: "no-focused-tab" },
	},

	// ── stop ───────────────────────────────────────────────────────────
	{
		name: "stop ends this vault's recording wherever focus is",
		input: { command: "stop", focused: A2, local: A1, remote: false },
		expected: { kind: "stop", origin: A1 },
	},
	{
		name: "stop with no focused tab still ends this vault's recording",
		input: { command: "stop", focused: null, local: A1, remote: false },
		expected: { kind: "stop", origin: A1 },
	},
	{
		name: "stop while another vault records → ask that vault to stop",
		input: { command: "stop", focused: A1, local: null, remote: true },
		expected: { kind: "stop-remote" },
	},
	{
		name: "stop with nothing recording → nothing",
		input: { command: "stop", focused: A1, local: null, remote: false },
		expected: { kind: "none", reason: "not-recording" },
	},

	// ── toggle (the mic button and "Start/stop voice input") ───────────
	{
		name: "toggle with nothing recording → start",
		input: { command: "toggle", focused: A1, local: null, remote: false },
		expected: { kind: "start", target: A1 },
	},
	{
		name: "toggle in the recording tab → stop",
		input: { command: "toggle", focused: A1, local: A1, remote: false },
		expected: { kind: "stop", origin: A1 },
	},
	{
		name: "toggle in another tab → hand off (not stop)",
		input: { command: "toggle", focused: A2, local: A1, remote: false },
		expected: {
			kind: "hand-off",
			from: { scope: "local", origin: A1 },
			target: A2,
		},
	},
	{
		name: "toggle while another vault records → hand off",
		input: { command: "toggle", focused: A1, local: null, remote: true },
		expected: { kind: "hand-off", from: { scope: "remote" }, target: A1 },
	},
	{
		name: "toggle with no focused tab ends this vault's recording",
		input: { command: "toggle", focused: null, local: A1, remote: false },
		expected: { kind: "stop", origin: A1 },
	},
	{
		name: "toggle with no focused tab asks the other vault to stop",
		input: { command: "toggle", focused: null, local: null, remote: true },
		expected: { kind: "stop-remote" },
	},
	{
		name: "toggle with no focused tab and nothing recording → nothing",
		input: { command: "toggle", focused: null, local: null, remote: false },
		expected: { kind: "none", reason: "no-focused-tab" },
	},

	// ── both flags set (lease says that can't happen) — local wins ──────
	{
		name: "local and remote both set: stop ends the local one",
		input: { command: "stop", focused: null, local: A1, remote: true },
		expected: { kind: "stop", origin: A1 },
	},
	{
		name: "local and remote both set: start elsewhere hands off from local",
		input: { command: "start", focused: A2, local: A1, remote: true },
		expected: {
			kind: "hand-off",
			from: { scope: "local", origin: A1 },
			target: A2,
		},
	},
];

describe("deriveVoiceTarget", () => {
	for (const c of CASES) {
		it(c.name, () => {
			expect(deriveVoiceTarget(c.input)).toEqual(c.expected);
		});
	}

	it("never targets a tab other than the focused one when starting", () => {
		for (const c of CASES) {
			const out = deriveVoiceTarget(c.input);
			if (out.kind === "start" || out.kind === "hand-off") {
				expect(out.target).toEqual(c.input.focused);
			}
		}
	});
});
