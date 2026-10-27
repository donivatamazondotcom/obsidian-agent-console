/**
 * Header agent + model segments — Kiro CLI V3 S2 and I207.
 *
 * - The header names the configured agent, and the agent actually running
 *   when they differ: struck through when the requested agent couldn't load
 *   (it isn't among the modes the server offers), "›" when the user switched
 *   to another available mode.
 * - The model comes from the confirmed model, then the legacy `models`
 *   state, then the `model` config option (Kiro CLI V3 sends only that).
 *
 * Spec: [[Kiro CLI V3 Support]] T4; [[I207 Header shows requested agent while session runs kiro_default]].
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";
import {
	deriveHeaderAgent,
	deriveHeaderModelName,
} from "../header-agent";
import type { SessionConfigOption, SessionModeState } from "../../types/session";
import { ChatHeader, type HeaderSegments } from "../../ui/ChatHeader";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
vi.mock("obsidian", () => ({ setIcon: vi.fn() }));

const modes = (current: string, ids: string[]): SessionModeState => ({
	currentModeId: current,
	availableModes: ids.map((id) => ({ id, name: id })),
});
const modeOption = (current: string, ids: string[]): SessionConfigOption => ({
	id: "mode",
	name: "Mode",
	category: "mode",
	type: "select",
	currentValue: current,
	options: ids.map((v) => ({ value: v, name: v === "vibe" ? "Default" : v })),
});

describe("deriveHeaderAgent", () => {
	it("no requested mode (non-Kiro agents): configured label only", () => {
		expect(deriveHeaderAgent({ label: "Claude Code", modes: modes("plan", ["plan", "build"]) }))
			.toEqual({ kind: "configured", label: "Claude Code" });
	});

	it("no mode info yet (connecting): configured label only", () => {
		expect(deriveHeaderAgent({ label: "Auto SA", requestedModeId: "auto-sa" }))
			.toEqual({ kind: "configured", label: "Auto SA" });
	});

	it("running the requested agent: configured label only", () => {
		expect(
			deriveHeaderAgent({
				label: "Auto SA",
				requestedModeId: "auto-sa",
				modes: modes("auto-sa", ["kiro_default", "auto-sa"]),
			}),
		).toEqual({ kind: "configured", label: "Auto SA" });
	});

	it("I207: requested agent not offered by the server → notLoaded with the running mode", () => {
		expect(
			deriveHeaderAgent({
				label: "Auto SA",
				requestedModeId: "auto-sa",
				modes: modes("kiro_default", ["kiro_default", "trd-pro"]),
			}),
		).toEqual({ kind: "notLoaded", label: "Auto SA", running: "kiro_default" });
	});

	it("user switched to another available mode → switched", () => {
		expect(
			deriveHeaderAgent({
				label: "Auto SA",
				requestedModeId: "auto-sa",
				modes: modes("trd-pro", ["kiro_default", "auto-sa", "trd-pro"]),
			}),
		).toEqual({ kind: "switched", label: "Auto SA", running: "trd-pro" });
	});

	it("prefers the mode config option (V3) and its display name", () => {
		expect(
			deriveHeaderAgent({
				label: "Auto SA",
				requestedModeId: "auto-sa",
				modes: modes("auto-sa", ["auto-sa"]),
				configOptions: [modeOption("vibe", ["vibe", "auto-sa"])],
			}),
		).toEqual({ kind: "switched", label: "Auto SA", running: "Default" });
	});
});

describe("deriveHeaderModelName", () => {
	const modelOption: SessionConfigOption = {
		id: "model",
		name: "Model",
		category: "model",
		type: "select",
		currentValue: "claude-opus-5.5",
		options: [{ value: "claude-opus-5.5", name: "Claude Opus 5.5" }],
	};

	it("V3: falls back to the model config option's display name", () => {
		expect(deriveHeaderModelName({ configOptions: [modelOption] })).toBe("Claude Opus 5.5");
	});

	it("confirmed model and legacy models still win (V2 unchanged)", () => {
		expect(
			deriveHeaderModelName({
				confirmedModelId: "x-confirmed",
				models: { currentModelId: "a", availableModels: [{ modelId: "a", name: "Legacy A" }] },
				configOptions: [modelOption],
			}),
		).toBe("x-confirmed");
		expect(
			deriveHeaderModelName({
				models: { currentModelId: "a", availableModels: [{ modelId: "a", name: "Legacy A" }] },
				configOptions: [modelOption],
			}),
		).toBe("Legacy A");
	});

	it("no model anywhere → null", () => {
		expect(deriveHeaderModelName({})).toBeNull();
	});
});

describe("ChatHeader agent segment", () => {
	const seg = (agent: HeaderSegments["agent"]): HeaderSegments => ({
		plugin: "Agent Console",
		profile: "Auto SA",
		runtime: null,
		model: "Claude Opus 5.5",
		agent,
	});
	const renderHeader = (segments: HeaderSegments) =>
		render(
			<ChatHeader
				agentLabel="Auto SA"
				headerSegments={segments}
				isUpdateAvailable={false}
				onUpdateClick={vi.fn()}
				onReload={vi.fn()}
				onExportChat={vi.fn()}
				onShowMenu={vi.fn()}
			/>,
		);

	it("notLoaded: strikes through the requested agent and names the running one", () => {
		const { container } = renderHeader(
			seg({ kind: "notLoaded", label: "Auto SA", running: "kiro_default" }),
		);
		const del = container.querySelector("del.acp-header-branded-profile");
		expect(del?.textContent).toBe("Auto SA");
		expect(container.querySelector(".acp-header-branded-running")?.textContent).toBe(
			"kiro_default",
		);
		// One tooltip only (INV-9): the title slot's aria-label carries it.
		const label = container
			.querySelector(".agent-client-chat-view-header-title")
			?.getAttribute("aria-label");
		expect(label).toContain("Auto SA");
		expect(label).toContain("kiro_default");
	});

	it("switched: no strikethrough, shows the running mode", () => {
		const { container } = renderHeader(
			seg({ kind: "switched", label: "Auto SA", running: "trd-pro" }),
		);
		expect(container.querySelector("del")).toBeNull();
		expect(container.querySelector(".acp-header-branded-running")?.textContent).toBe("trd-pro");
	});

	it("configured (or absent): renders the profile as today", () => {
		const { container } = renderHeader(seg(undefined));
		expect(container.querySelector("del")).toBeNull();
		expect(container.querySelector(".acp-header-branded-running")).toBeNull();
		expect(container.querySelector(".acp-header-branded-profile")?.textContent).toBe("Auto SA");
	});
});
