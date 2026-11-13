/**
 * deriveHeaderExtras — the grey text after the chat title (Session Title in
 * the Chat Header, Test 3).
 *
 * The header adds only what the composer doesn't show and the title doesn't
 * already say, plus the "agent didn't load" warning, which always shows.
 * Expected values are written out per row (no re-derivation of the rule).
 */
import { describe, expect, it } from "vitest";

import { deriveHeaderExtras, type HeaderExtras } from "../header-extras";
import type { HeaderAgent } from "../header-agent";
import type { ComposerPickers } from "../composer-pickers";

const configured: HeaderAgent = { kind: "configured", label: "Claude Code" };
const kiroConfigured: HeaderAgent = { kind: "configured", label: "Auto SA" };
const switched: HeaderAgent = { kind: "switched", label: "Research", running: "writer" };
const notLoaded: HeaderAgent = { kind: "notLoaded", label: "Auto SA", running: "kiro_default" };

const NONE: ComposerPickers = { source: "none" };
const CONFIG_MODE_MODEL: ComposerPickers = { source: "config", shown: [], mode: true, model: true };
const CONFIG_MODEL_ONLY: ComposerPickers = { source: "config", shown: [], mode: false, model: true };
const CONFIG_NOTHING: ComposerPickers = { source: "config", shown: [], mode: false, model: false };
const LEGACY_MODE_ONLY: ComposerPickers = { source: "legacy", mode: true, model: false };
const LEGACY_MODEL_ONLY: ComposerPickers = { source: "legacy", mode: false, model: true };

const model = (name: string | null, confirmedDiffers = false) => ({ name, confirmedDiffers });

interface Row {
	name: string;
	agent: HeaderAgent;
	model: { name: string | null; confirmedDiffers: boolean };
	composer: ComposerPickers;
	modesAreAgents: boolean;
	titleIsDefault: boolean;
	expected: HeaderExtras;
}

const rows: Row[] = [
	{
		name: "connected Kiro V3 (mode and model pickers): no extras",
		agent: kiroConfigured, model: model("Claude Opus 5.5"), composer: CONFIG_MODE_MODEL,
		modesAreAgents: true, titleIsDefault: false,
		expected: { agent: null, model: null },
	},
	{
		name: "Kiro before connecting (no pickers yet), titled: agent label",
		agent: kiroConfigured, model: model(null), composer: NONE,
		modesAreAgents: true, titleIsDefault: false,
		expected: { agent: { kind: "label", label: "Auto SA" }, model: null },
	},
	{
		name: "Kiro before connecting, default title: nothing (the title names the agent)",
		agent: kiroConfigured, model: model(null), composer: NONE,
		modesAreAgents: true, titleIsDefault: true,
		expected: { agent: null, model: null },
	},
	{
		name: "Kiro V2 with a legacy mode picker and no model picker: model only",
		agent: kiroConfigured, model: model("Claude Sonnet 4"), composer: LEGACY_MODE_ONLY,
		modesAreAgents: true, titleIsDefault: false,
		expected: { agent: null, model: "Claude Sonnet 4" },
	},
	{
		name: "Claude Code titled, model picker: agent label only",
		agent: configured, model: model("Opus"), composer: CONFIG_MODEL_ONLY,
		modesAreAgents: false, titleIsDefault: false,
		expected: { agent: { kind: "label", label: "Claude Code" }, model: null },
	},
	{
		name: "Claude Code default title, model picker: nothing",
		agent: configured, model: model("Opus"), composer: CONFIG_MODEL_ONLY,
		modesAreAgents: false, titleIsDefault: true,
		expected: { agent: null, model: null },
	},
	{
		name: "non-Kiro agent with a legacy mode picker: the mode picker doesn't name the agent",
		agent: configured, model: model(null), composer: LEGACY_MODE_ONLY,
		modesAreAgents: false, titleIsDefault: false,
		expected: { agent: { kind: "label", label: "Claude Code" }, model: null },
	},
	{
		name: "agent with no model picker: agent label and model",
		agent: { kind: "configured", label: "Codex" }, model: model("gpt-5"), composer: CONFIG_NOTHING,
		modesAreAgents: false, titleIsDefault: false,
		expected: { agent: { kind: "label", label: "Codex" }, model: "gpt-5" },
	},
	{
		name: "agent with no model picker, default title: model only",
		agent: { kind: "configured", label: "Codex" }, model: model("gpt-5"), composer: NONE,
		modesAreAgents: false, titleIsDefault: true,
		expected: { agent: null, model: "gpt-5" },
	},
	{
		name: "requested agent didn't load, Kiro mode picker shown: the warning stays",
		agent: notLoaded, model: model("Opus"), composer: CONFIG_MODE_MODEL,
		modesAreAgents: true, titleIsDefault: false,
		expected: { agent: { kind: "notLoaded", label: "Auto SA", running: "kiro_default" }, model: null },
	},
	{
		name: "requested agent didn't load, default title: the warning stays",
		agent: notLoaded, model: model(null), composer: NONE,
		modesAreAgents: true, titleIsDefault: true,
		expected: { agent: { kind: "notLoaded", label: "Auto SA", running: "kiro_default" }, model: null },
	},
	{
		name: "switched with the Kiro mode picker shown: nothing (the picker names it)",
		agent: switched, model: model(null), composer: CONFIG_MODE_MODEL,
		modesAreAgents: true, titleIsDefault: false,
		expected: { agent: null, model: null },
	},
	{
		name: "switched without a mode picker: label › running",
		agent: switched, model: model(null), composer: LEGACY_MODEL_ONLY,
		modesAreAgents: true, titleIsDefault: false,
		expected: { agent: { kind: "switched", label: "Research", running: "writer" }, model: null },
	},
	{
		name: "switched on a default title still says what's running",
		agent: switched, model: model(null), composer: NONE,
		modesAreAgents: false, titleIsDefault: true,
		expected: { agent: { kind: "switched", label: "Research", running: "writer" }, model: null },
	},
	{
		name: "the agent ran a different model than the pick: model shown next to the picker",
		agent: kiroConfigured, model: model("Claude Sonnet 5", true), composer: CONFIG_MODE_MODEL,
		modesAreAgents: true, titleIsDefault: false,
		expected: { agent: null, model: "Claude Sonnet 5" },
	},
	{
		name: "no model known: no model extra even without a picker",
		agent: configured, model: model(null, true), composer: NONE,
		modesAreAgents: false, titleIsDefault: false,
		expected: { agent: { kind: "label", label: "Claude Code" }, model: null },
	},
];

describe("deriveHeaderExtras", () => {
	it.each(rows)("$name", (row) => {
		expect(
			deriveHeaderExtras({
				agent: row.agent,
				model: row.model,
				composer: row.composer,
				modesAreAgents: row.modesAreAgents,
				titleIsDefault: row.titleIsDefault,
			}),
		).toEqual(row.expected);
	});
});
