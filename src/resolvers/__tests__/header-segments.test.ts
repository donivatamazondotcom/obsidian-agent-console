/**
 * deriveHeaderSegments — what ChatPanel hands the chat header (Session Title
 * in the Chat Header, code review round 1, test gap T1).
 *
 * The header-segments wiring used to live inline in ChatPanel's memo, where no
 * test could reach it: which field feeds `titleIsDefault`, which signal says
 * "this is Kiro", and whether the requested Kiro agent is consulted for a
 * non-Kiro tab. These rows pin it at the one function ChatPanel now calls.
 * Composer inputs come from the production `deriveComposerPickers`; expected
 * values are literal.
 */
import { describe, expect, it } from "vitest";

import { deriveHeaderSegments, type HeaderSegmentsInput } from "../header-segments";
import { deriveComposerPickers } from "../composer-pickers";
import type { SessionConfigOption, SessionModeState } from "../../types/session";

const option = (
	id: string,
	current: string,
	choices: [string, string][],
): SessionConfigOption => ({
	id,
	name: id,
	category: id,
	type: "select",
	currentValue: current,
	options: choices.map(([value, name]) => ({ value, name })),
});

const KIRO_OPTIONS = (currentMode: string, modes: [string, string][]) => [
	option("mode", currentMode, modes),
	option("model", "opus", [
		["opus", "claude-opus-5.5"],
		["sonnet", "claude-sonnet-5"],
	]),
];

const CLAUDE_MODES: SessionModeState = {
	availableModes: [
		{ id: "default", name: "Default" },
		{ id: "plan", name: "Plan" },
	],
	currentModeId: "default",
} as unknown as SessionModeState;

function input(over: Partial<HeaderSegmentsInput> & { session: HeaderSegmentsInput["session"] }): HeaderSegmentsInput {
	const s = over.session;
	return {
		title: "Explain vector embeddings",
		titleIsDefault: false,
		profile: "Auto SA",
		cwd: "/vault",
		composer: deriveComposerPickers({
			configOptions: s.configOptions,
			modes: s.modes,
			models: s.models,
			canChangeMode: true,
			canChangeModel: true,
		}),
		...over,
	};
}

describe("deriveHeaderSegments", () => {
	it("connected Kiro V3: title only; the tooltip still names agent, engine and model", () => {
		const seg = deriveHeaderSegments(
			input({
				configuredKiroAgent: "auto-sa",
				session: {
					kiroCli: true,
					kiroEngine: "v3",
					configOptions: KIRO_OPTIONS("auto-sa", [
						["auto-sa", "auto-sa"],
						["kiro_default", "kiro_default"],
					]),
				},
			}),
		);
		expect(seg.title).toBe("Explain vector embeddings");
		expect(seg.extras).toEqual({ agent: null, model: null });
		expect(seg.agent).toEqual({ kind: "configured", label: "Auto SA" });
		expect(seg.engine).toEqual({ kind: "kiroCli", engine: "v3" });
		expect(seg.model).toBe("claude-opus-5.5");
		expect(seg.mode).toBeNull();
		expect(seg.folder).toBe("/vault");
	});

	it("Kiro: the requested agent isn't offered → the warning (I207)", () => {
		const seg = deriveHeaderSegments(
			input({
				configuredKiroAgent: "auto-sa",
				session: {
					kiroCli: true,
					kiroEngine: "v3",
					configOptions: KIRO_OPTIONS("kiro_default", [
						["kiro_default", "kiro_default"],
						["writer", "writer"],
					]),
				},
			}),
		);
		expect(seg.extras.agent).toEqual({
			kind: "notLoaded",
			label: "Auto SA",
			running: "kiro_default",
		});
	});

	it("a non-Kiro tab never consults a configured --agent, even when its modes don't match", () => {
		const seg = deriveHeaderSegments(
			input({
				profile: "Claude Code",
				title: "Debug the failing CI pipeline",
				configuredKiroAgent: "auto-sa",
				session: {
					kiroCli: false,
					modes: CLAUDE_MODES,
					configOptions: [option("model", "opus", [["opus", "Opus"], ["sonnet", "Sonnet"]])],
				},
			}),
		);
		expect(seg.agent).toEqual({ kind: "configured", label: "Claude Code" });
		expect(seg.extras).toEqual({ agent: { kind: "label", label: "Claude Code" }, model: null });
	});

	it("Claude Code default title: no grey agent name", () => {
		const seg = deriveHeaderSegments(
			input({
				profile: "Claude Code",
				title: "Claude Code 08:14 AM",
				titleIsDefault: true,
				session: {
					kiroCli: false,
					configOptions: [option("model", "opus", [["opus", "Opus"], ["sonnet", "Sonnet"]])],
				},
			}),
		);
		expect(seg.titleIsDefault).toBe(true);
		expect(seg.extras).toEqual({ agent: null, model: null });
	});

	it("an agent with no pickers at all: agent label and model", () => {
		const seg = deriveHeaderSegments(
			input({
				profile: "Codex",
				session: {
					kiroCli: false,
					models: { availableModels: [{ modelId: "g5", name: "gpt-5" }], currentModelId: "g5" },
				},
			}),
		);
		expect(seg.extras).toEqual({ agent: { kind: "label", label: "Codex" }, model: "gpt-5" });
	});
});
