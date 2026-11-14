/**
 * The chat header shows the chat's title (Session Title in the Chat Header,
 * Tests 5 and 6).
 *
 * Test 6 — what ChatHeader renders: the title, then a grey extras group that
 * starts with " · "; the struck-out "agent didn't load" warning; no
 * "[Agent Console]", "Connecting…" or "Not connected" in any state; a tooltip
 * whose first line names the chat; the short Update pill.
 *
 * Test 5 — the header and the composer never both name the agent or the model.
 * Both are rendered from the same session fixture, with inputs built by the
 * production resolvers ChatPanel uses.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

// setTooltip writes aria-label, like the real one; that is what the tooltip
// and accessible-name assertions read.
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

import { ChatHeader, type HeaderSegments } from "../ChatHeader";
import { initLocale, resetLocaleForTests } from "../../i18n";
import { InputToolbar } from "../InputToolbar";
import { deriveComposerPickers } from "../../resolvers/composer-pickers";
import { deriveHeaderExtras, type HeaderExtras } from "../../resolvers/header-extras";
import {
	deriveConfirmedModelDiffers,
	deriveHeaderAgent,
	deriveHeaderModelName,
} from "../../resolvers/header-agent";
import type {
	SessionConfigOption,
	SessionModeState,
} from "../../types/session";

afterEach(cleanup);

function segments(overrides: Partial<HeaderSegments> = {}): HeaderSegments {
	return {
		title: "Debug the failing CI pipeline",
		titleIsDefault: false,
		extras: { agent: { kind: "label", label: "Claude Code" }, model: null },
		profile: "Claude Code",
		engine: { kind: "unknown" },
		model: null,
		effort: null,
		mode: null,
		folder: null,
		...overrides,
	};
}

function renderHeader(seg: HeaderSegments, isUpdateAvailable = false) {
	return render(
		<ChatHeader
			agentLabel={seg.profile}
			headerSegments={seg}
			isUpdateAvailable={isUpdateAvailable}
			onUpdateClick={vi.fn()}
			onReload={vi.fn()}
			onExportChat={vi.fn()}
			onShowMenu={vi.fn()}
		/>,
	);
}

const q = (c: HTMLElement, sel: string) => c.querySelector<HTMLElement>(sel);

describe("ChatHeader shows the chat title (Test 6)", () => {
	it("title, then the grey extras group starting with ' · '; no plugin prefix", () => {
		const { container } = renderHeader(segments());
		expect(q(container, ".acp-header-branded-title")?.textContent).toBe(
			"Debug the failing CI pipeline",
		);
		const extras = q(container, ".acp-header-branded-extras");
		expect(extras?.textContent).toBe(" · Claude Code");
		expect(extras?.firstElementChild?.classList.contains("acp-header-branded-sep")).toBe(true);
		expect(container.textContent).not.toContain("[Agent Console]");
		expect(container.textContent).not.toContain("Agent Console]");
	});

	it("no extras: just the title, no extras element", () => {
		const { container } = renderHeader(
			segments({ titleIsDefault: true, title: "Claude Code 08:14 AM", extras: { agent: null, model: null } }),
		);
		expect(q(container, ".acp-header-branded")?.textContent).toBe("Claude Code 08:14 AM");
		expect(q(container, ".acp-header-branded-extras")).toBeNull();
	});

	it("agent and model: separated by ' · '", () => {
		const { container } = renderHeader(
			segments({ extras: { agent: { kind: "label", label: "Codex" }, model: "gpt-5" } }),
		);
		expect(q(container, ".acp-header-branded-extras")?.textContent).toBe(" · Codex · gpt-5");
	});

	it("model only: one separator", () => {
		const { container } = renderHeader(segments({ extras: { agent: null, model: "Claude Sonnet 4" } }));
		expect(q(container, ".acp-header-branded-extras")?.textContent).toBe(" · Claude Sonnet 4");
	});

	it("agent didn't load: struck-out name, running agent, warning modifier", () => {
		const { container } = renderHeader(
			segments({
				extras: { agent: { kind: "notLoaded", label: "Auto SA", running: "kiro_default" }, model: null },
			}),
		);
		expect(q(container, "del.acp-header-branded-profile")?.textContent).toBe("Auto SA");
		expect(q(container, ".acp-header-branded-running")?.textContent).toBe("kiro_default");
		expect(q(container, ".acp-header-branded")?.classList.contains("acp-header-branded--warning")).toBe(true);
		expect(q(container, ".acp-header-branded-extras")?.textContent).toBe(" · Auto SA kiro_default");
	});

	it("switched: 'label › running'", () => {
		const { container } = renderHeader(
			segments({ extras: { agent: { kind: "switched", label: "Research", running: "writer" }, model: null } }),
		);
		expect(q(container, ".acp-header-branded-extras")?.textContent).toBe(" · Research › writer");
		expect(q(container, ".acp-header-branded")?.classList.contains("acp-header-branded--warning")).toBe(false);
	});

	it.each([
		["connecting", { isConnecting: true }],
		["not connecting", { isConnecting: false }],
	] as const)("never shows 'Connecting…' or 'Not connected' in the header text (%s)", (_n, o) => {
		const { container } = renderHeader(segments({ ...o, extras: { agent: null, model: null } }));
		const text = q(container, ".agent-client-chat-view-header-title")?.textContent ?? "";
		expect(text).not.toContain("Connecting");
		expect(text).not.toContain("Not connected");
	});

	it("the tooltip's first line names the chat; the agent line follows", () => {
		const { container } = renderHeader(segments());
		const label = q(container, ".acp-header-branded")?.getAttribute("aria-label") ?? "";
		const lines = label.split("\n");
		expect(lines[0]).toBe("Chat: Debug the failing CI pipeline");
		expect(lines[1]).toBe("Agent: Claude Code");
	});

	it.each([
		["ja", "更新", "プラグインの更新があります！"],
		["ko", "업데이트", "플러그인 업데이트 가능!"],
		["zh", "更新", "插件有可用更新！"],
	])("%s: the pill's accessible name starts with its visible word", (locale, word, longText) => {
		initLocale(locale);
		try {
			const { container } = renderHeader(segments(), true);
			const pill = q(container, ".agent-client-chat-view-header-update");
			expect(pill?.textContent).toBe(word);
			const name = pill?.getAttribute("aria-label") ?? "";
			expect(name.startsWith(word)).toBe(true);
			expect(name).toContain(longText);
		} finally {
			resetLocaleForTests();
		}
	});

	it("the update pill reads 'Update'; its name keeps 'Plugin update available!'", () => {
		const { container } = renderHeader(segments(), true);
		const pill = q(container, ".agent-client-chat-view-header-update");
		expect(pill?.textContent).toBe("Update");
		const name = pill?.getAttribute("aria-label") ?? "";
		expect(name.startsWith("Update")).toBe(true);
		expect(name).toContain("Plugin update available!");
	});
});

// ----------------------------------------------------------------------------
// Test 5: header vs composer
// ----------------------------------------------------------------------------

const option = (
	id: string,
	category: string,
	current: string,
	choices: [string, string][],
): SessionConfigOption => ({
	id,
	name: id,
	category,
	type: "select",
	currentValue: current,
	options: choices.map(([value, name]) => ({ value, name })),
});

interface Fixture {
	label: string;
	requestedModeId?: string;
	kiroCli: boolean;
	configOptions: SessionConfigOption[];
	modes?: SessionModeState;
	title: string;
}

/** Header inputs exactly as ChatPanel builds them, from production resolvers. */
function headerFor(f: Fixture): HeaderSegments {
	const composer = deriveComposerPickers({
		configOptions: f.configOptions,
		modes: f.modes,
		canChangeMode: true,
		canChangeModel: true,
	});
	const agent = deriveHeaderAgent({
		label: f.label,
		requestedModeId: f.requestedModeId,
		modes: f.modes,
		configOptions: f.configOptions,
	});
	const modelInput = { configOptions: f.configOptions };
	const model = deriveHeaderModelName(modelInput);
	const extras: HeaderExtras = deriveHeaderExtras({
		agent,
		model: { name: model, confirmedDiffers: deriveConfirmedModelDiffers(modelInput) },
		composer,
		modesAreAgents: f.kiroCli,
		titleIsDefault: false,
	});
	return segments({ title: f.title, profile: f.label, extras, model, agent });
}

function renderBoth(f: Fixture) {
	const header = renderHeader(headerFor(f)).container;
	const pickers = deriveComposerPickers({
		configOptions: f.configOptions,
		modes: f.modes,
		canChangeMode: true,
		canChangeModel: true,
	});
	const composer = render(
		<InputToolbar
			isSending={false}
			isButtonDisabled={false}
			hasContent={true}
			onSendOrStop={vi.fn()}
			lazyState={"ready" as never}
			configOptions={f.configOptions}
			onConfigOptionChange={vi.fn()}
			modes={f.modes}
			onModeChange={vi.fn()}
			composerPickers={pickers}
		/>,
	).container;
	const headerText = (q(header, ".acp-header-branded")?.textContent ?? "").toLowerCase();
	const composerText = (composer.textContent ?? "").toLowerCase();
	return { headerText, composerText };
}

describe("the header and the composer never both name the agent or the model (Test 5)", () => {
	it("connected Kiro V3 (mode and model config options): the header is the title alone", () => {
		const { headerText, composerText } = renderBoth({
			label: "Auto SA",
			requestedModeId: "auto-sa",
			kiroCli: true,
			title: "Explain vector embeddings",
			configOptions: [
				option("mode", "mode", "auto-sa", [["auto-sa", "auto-sa"], ["kiro_default", "kiro_default"]]),
				option("model", "model", "opus", [["opus", "claude-opus-5.5"], ["sonnet", "claude-sonnet-5"]]),
				option("thought_level", "thought_level", "x", [["x", "xHigh"], ["h", "High"]]),
			],
		});
		expect(headerText).toBe("explain vector embeddings");
		expect(composerText).toContain("auto-sa");
		expect(composerText).toContain("claude-opus-5.5");
		for (const name of ["auto-sa", "auto sa", "claude-opus-5.5"]) {
			expect(headerText.includes(name) && composerText.includes(name)).toBe(false);
		}
	});

	it("Claude Code (model config option, no agent picker): agent in the header, model in the composer", () => {
		const { headerText, composerText } = renderBoth({
			label: "Claude Code",
			kiroCli: false,
			title: "Debug the failing CI pipeline",
			configOptions: [option("model", "model", "opus", [["opus", "Opus"], ["sonnet", "Sonnet"]])],
			modes: {
				availableModes: [
					{ id: "default", name: "Default" },
					{ id: "plan", name: "Plan" },
				],
				currentModeId: "default",
			} as unknown as SessionModeState,
		});
		expect(headerText).toContain("claude code");
		expect(composerText).not.toContain("claude code");
		expect(composerText).toContain("opus");
		expect(headerText).not.toContain("opus");
	});
});
