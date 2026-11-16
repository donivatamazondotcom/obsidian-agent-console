/**
 * Composer picker set — characterization (Session Title in the Chat Header,
 * Test 1).
 *
 * Pins WHICH selectors InputToolbar renders for each shape of session state,
 * as the code decides it today (InputToolbar.tsx, the config-option branch and
 * the legacy mode/model branch). The header-title feature moves that decision
 * into `deriveComposerPickers` so the header can read the same answer; this
 * test was written and green on `main` before the refactor and must stay green
 * unchanged after it.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import * as React from "react";

import { InputToolbar } from "../InputToolbar";
import type {
	SessionConfigOption,
	SessionModelState,
	SessionModeState,
} from "../../types/session";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
	setTooltip: vi.fn((el: HTMLElement, text: string) => {
		el.setAttribute("aria-label", text);
	}),
	Menu: class {
		addItem() {
			return this;
		}
		showAtMouseEvent() {}
		showAtPosition() {}
	},
	MarkdownRenderer: { render: vi.fn() },
	Component: class {},
	Platform: { isMobile: false },
}));

const MODE_OPTION: SessionConfigOption = {
	id: "mode",
	name: "Agent",
	category: "mode",
	type: "select",
	currentValue: "team-agent",
	options: [
		{ value: "team-agent", name: "team-agent" },
		{ value: "kiro_default", name: "kiro_default" },
	],
};

const MODEL_OPTION: SessionConfigOption = {
	id: "model",
	name: "Model",
	category: "model",
	type: "select",
	currentValue: "opus",
	options: [
		{ value: "opus", name: "claude-opus-5.5" },
		{ value: "sonnet", name: "claude-sonnet-5" },
		{ value: "haiku", name: "claude-haiku-5" },
	],
};

/** One choice only: the toolbar hides it. */
const SINGLE_CHOICE_OPTION: SessionConfigOption = {
	id: "thought_level",
	name: "Effort",
	category: "thought_level",
	type: "select",
	currentValue: "high",
	options: [{ value: "high", name: "High" }],
};

/** No category: rendered with no category class. */
const UNCATEGORIZED_OPTION: SessionConfigOption = {
	id: "approval",
	name: "Approval",
	type: "select",
	currentValue: "on",
	options: [
		{ value: "on", name: "Enabled" },
		{ value: "off", name: "Disabled" },
	],
};

const GROUPED_MODEL_OPTION: SessionConfigOption = {
	id: "model",
	name: "Model",
	category: "model",
	type: "select",
	currentValue: "b1",
	options: [
		{
			group: "a",
			name: "Fast",
			options: [{ value: "a1", name: "Haiku" }],
		},
		{
			group: "b",
			name: "Deep",
			options: [{ value: "b1", name: "Opus" }],
		},
	],
};

const MODES: SessionModeState = {
	availableModes: [
		{ id: "ask", name: "Ask" },
		{ id: "code", name: "Code" },
	],
	currentModeId: "ask",
} as unknown as SessionModeState;

const MODELS: SessionModelState = {
	availableModels: [
		{ modelId: "sonnet-4-5", name: "Sonnet 4.5" },
		{ modelId: "opus-5", name: "Opus 5" },
		{ modelId: "haiku-5", name: "Haiku 5" },
	],
	currentModelId: "sonnet-4-5",
} as unknown as SessionModelState;

/** What a rendered selector looks like from the outside. */
interface Rendered {
	label: string;
	category: string | null;
}

function renderedSelectors(extra: Record<string, unknown>): Rendered[] {
	const { container } = render(
		<InputToolbar
			isSending={false}
			isButtonDisabled={false}
			hasContent={true}
			onSendOrStop={vi.fn()}
			lazyState={{ kind: "ready" } as never}
			{...extra}
		/>,
	);
	return Array.from(
		container.querySelectorAll<HTMLElement>(".agent-client-toolbar-dropdown"),
	).map((el) => {
		const cls = Array.from(el.classList).find((c) =>
			c.startsWith("agent-client-config-selector-"),
		);
		return {
			label:
				el.querySelector(".agent-client-toolbar-dropdown-label")
					?.textContent ?? "",
			category: cls ? cls.replace("agent-client-config-selector-", "") : null,
		};
	});
}

describe("composer picker set (characterization)", () => {
	afterEach(cleanup);

	it("config options only: renders each option with more than one choice, in order", () => {
		expect(
			renderedSelectors({
				configOptions: [
					MODE_OPTION,
					MODEL_OPTION,
					SINGLE_CHOICE_OPTION,
					UNCATEGORIZED_OPTION,
				],
				onConfigOptionChange: vi.fn(),
			}),
		).toEqual([
			{ label: "team-agent", category: "mode" },
			{ label: "claude-opus-5.5", category: "model" },
			{ label: "Enabled", category: null },
		]);
	});

	it("config options plus legacy modes and models: the legacy selectors are hidden", () => {
		expect(
			renderedSelectors({
				configOptions: [MODEL_OPTION],
				onConfigOptionChange: vi.fn(),
				modes: MODES,
				onModeChange: vi.fn(),
				models: MODELS,
				onModelChange: vi.fn(),
			}),
		).toEqual([{ label: "claude-opus-5.5", category: "model" }]);
	});

	it("config options that all have one choice still hide the legacy selectors: nothing renders", () => {
		expect(
			renderedSelectors({
				configOptions: [SINGLE_CHOICE_OPTION],
				onConfigOptionChange: vi.fn(),
				models: MODELS,
				onModelChange: vi.fn(),
			}),
		).toEqual([]);
	});

	it("grouped config options: one selector, labelled 'Group / Option'", () => {
		expect(
			renderedSelectors({
				configOptions: [GROUPED_MODEL_OPTION],
				onConfigOptionChange: vi.fn(),
			}),
		).toEqual([{ label: "Deep / Opus", category: "model" }]);
	});

	it("legacy modes and models with change handlers: both render, mode first", () => {
		expect(
			renderedSelectors({
				modes: MODES,
				onModeChange: vi.fn(),
				models: MODELS,
				onModelChange: vi.fn(),
			}),
		).toEqual([
			{ label: "Ask", category: null },
			{ label: "Sonnet 4.5", category: null },
		]);
	});

	it("legacy selectors without a change handler don't render", () => {
		expect(renderedSelectors({ modes: MODES, models: MODELS })).toEqual([]);
		cleanup();
		expect(
			renderedSelectors({ modes: MODES, models: MODELS, onModeChange: vi.fn() }),
		).toEqual([{ label: "Ask", category: null }]);
	});

	it("legacy lists with a single entry don't render", () => {
		expect(
			renderedSelectors({
				modes: { availableModes: [{ id: "ask", name: "Ask" }], currentModeId: "ask" },
				onModeChange: vi.fn(),
				models: {
					availableModels: [{ modelId: "m", name: "Only" }],
					currentModelId: "m",
				},
				onModelChange: vi.fn(),
			}),
		).toEqual([]);
	});

	it("no session state: nothing renders", () => {
		expect(renderedSelectors({})).toEqual([]);
		cleanup();
		expect(
			renderedSelectors({ configOptions: [], onConfigOptionChange: vi.fn() }),
		).toEqual([]);
	});
});
