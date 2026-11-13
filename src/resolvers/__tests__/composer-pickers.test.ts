/**
 * deriveComposerPickers — which pickers the composer shows (Session Title in
 * the Chat Header, Test 2). One answer read by both the composer toolbar and
 * the chat header, so the header can leave out what the composer already
 * shows. The rows mirror the InputToolbar characterization test
 * (composer-pickers-characterization.test.tsx) at the resolver level.
 */
import { describe, expect, it } from "vitest";

import {
	deriveComposerPickers,
	matchesOptionKind,
	type ComposerPickers,
} from "../composer-pickers";
import type {
	SessionConfigOption,
	SessionModelState,
	SessionModeState,
} from "../../types/session";

function option(
	id: string,
	category: string | null | undefined,
	choices: number,
): SessionConfigOption {
	return {
		id,
		name: id,
		category,
		type: "select",
		currentValue: "v0",
		options: Array.from({ length: choices }, (_, i) => ({
			value: `v${i}`,
			name: `Choice ${i}`,
		})),
	};
}

const MODES: SessionModeState = {
	availableModes: [
		{ id: "ask", name: "Ask" },
		{ id: "code", name: "Code" },
	],
	currentModeId: "ask",
} as unknown as SessionModeState;

const MODELS: SessionModelState = {
	availableModels: [
		{ modelId: "a", name: "A" },
		{ modelId: "b", name: "B" },
	],
	currentModelId: "a",
} as unknown as SessionModelState;

const HANDLERS = { canChangeMode: true, canChangeModel: true };

describe("deriveComposerPickers", () => {
	it("config options: shows each option with more than one choice, in order, and reports mode/model", () => {
		const mode = option("mode", "mode", 2);
		const model = option("model", "model", 3);
		const effort = option("thought_level", "thought_level", 1);
		const approval = option("approval", null, 2);
		expect(
			deriveComposerPickers({
				configOptions: [mode, model, effort, approval],
				...HANDLERS,
			}),
		).toEqual<ComposerPickers>({
			source: "config",
			shown: [mode, model, approval],
			mode: true,
			model: true,
		});
	});

	it("a one-choice config option is neither shown nor counted", () => {
		const mode = option("mode", "mode", 2);
		const model = option("model", "model", 1);
		expect(
			deriveComposerPickers({ configOptions: [mode, model], ...HANDLERS }),
		).toEqual({ source: "config", shown: [mode], mode: true, model: false });
	});

	it("config options supersede legacy modes and models", () => {
		const model = option("model", "model", 2);
		expect(
			deriveComposerPickers({
				configOptions: [model],
				modes: MODES,
				models: MODELS,
				...HANDLERS,
			}),
		).toEqual({ source: "config", shown: [model], mode: false, model: true });
	});

	it("config options that all have one choice still hide legacy pickers: nothing shows", () => {
		expect(
			deriveComposerPickers({
				configOptions: [option("thought_level", "thought_level", 1)],
				models: MODELS,
				...HANDLERS,
			}),
		).toEqual({ source: "config", shown: [], mode: false, model: false });
	});

	it("grouped options count their flattened choices", () => {
		const grouped: SessionConfigOption = {
			id: "model",
			name: "Model",
			category: "model",
			type: "select",
			currentValue: "b1",
			options: [
				{ group: "a", name: "Fast", options: [{ value: "a1", name: "Haiku" }] },
				{ group: "b", name: "Deep", options: [{ value: "b1", name: "Opus" }] },
			],
		};
		expect(
			deriveComposerPickers({ configOptions: [grouped], ...HANDLERS }),
		).toEqual({ source: "config", shown: [grouped], mode: false, model: true });
	});

	it("mode and model are recognised by id or by category", () => {
		const byCategory = option("agent", "mode", 2);
		const byId = option("model", null, 2);
		expect(
			deriveComposerPickers({ configOptions: [byCategory, byId], ...HANDLERS }),
		).toEqual({
			source: "config",
			shown: [byCategory, byId],
			mode: true,
			model: true,
		});
	});

	it("legacy modes and models with change handlers", () => {
		expect(
			deriveComposerPickers({ modes: MODES, models: MODELS, ...HANDLERS }),
		).toEqual({ source: "legacy", mode: true, model: true });
	});

	it("a legacy picker needs a change handler", () => {
		expect(
			deriveComposerPickers({
				modes: MODES,
				models: MODELS,
				canChangeMode: true,
				canChangeModel: false,
			}),
		).toEqual({ source: "legacy", mode: true, model: false });
		expect(
			deriveComposerPickers({
				modes: MODES,
				models: MODELS,
				canChangeMode: false,
				canChangeModel: false,
			}),
		).toEqual({ source: "none" });
	});

	it("legacy lists with one entry show nothing", () => {
		expect(
			deriveComposerPickers({
				modes: { availableModes: [{ id: "ask", name: "Ask" }], currentModeId: "ask" },
				models: { availableModels: [{ modelId: "m", name: "M" }], currentModelId: "m" },
				...HANDLERS,
			}),
		).toEqual({ source: "none" });
	});

	it("no session state, or an empty config list with no legacy state, shows nothing", () => {
		expect(deriveComposerPickers({ ...HANDLERS })).toEqual({ source: "none" });
		expect(
			deriveComposerPickers({ configOptions: [], ...HANDLERS }),
		).toEqual({ source: "none" });
	});
});

describe("matchesOptionKind", () => {
	it("matches on id or on category", () => {
		expect(matchesOptionKind(option("mode", null, 2), "mode")).toBe(true);
		expect(matchesOptionKind(option("agent", "mode", 2), "mode")).toBe(true);
		expect(matchesOptionKind(option("agent", "model", 2), "mode")).toBe(false);
	});
});
