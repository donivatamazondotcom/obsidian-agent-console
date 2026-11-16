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
vi.mock("obsidian", () => ({ setIcon: vi.fn(), setTooltip: vi.fn() }));

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
		expect(deriveHeaderAgent({ label: "Team Agent", requestedModeId: "team-agent" }))
			.toEqual({ kind: "configured", label: "Team Agent" });
	});

	it("running the requested agent: configured label only", () => {
		expect(
			deriveHeaderAgent({
				label: "Team Agent",
				requestedModeId: "team-agent",
				modes: modes("team-agent", ["kiro_default", "team-agent"]),
			}),
		).toEqual({ kind: "configured", label: "Team Agent" });
	});

	it("I207: requested agent not offered by the server → notLoaded with the running mode", () => {
		expect(
			deriveHeaderAgent({
				label: "Team Agent",
				requestedModeId: "team-agent",
				modes: modes("kiro_default", ["kiro_default", "trd-pro"]),
			}),
		).toEqual({ kind: "notLoaded", label: "Team Agent", running: "kiro_default" });
	});

	it("user switched to another available mode → switched", () => {
		expect(
			deriveHeaderAgent({
				label: "Team Agent",
				requestedModeId: "team-agent",
				modes: modes("trd-pro", ["kiro_default", "team-agent", "trd-pro"]),
			}),
		).toEqual({ kind: "switched", label: "Team Agent", running: "trd-pro" });
	});

	it("prefers the mode config option (V3) and its display name", () => {
		expect(
			deriveHeaderAgent({
				label: "Team Agent",
				requestedModeId: "team-agent",
				modes: modes("team-agent", ["team-agent"]),
				configOptions: [modeOption("vibe", ["vibe", "team-agent"])],
			}),
		).toEqual({ kind: "switched", label: "Team Agent", running: "Default" });
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

	const legacy = { currentModelId: "a", availableModels: [{ modelId: "a", name: "Legacy A" }] };

	it("V2: legacy models alone still name the model", () => {
		expect(deriveHeaderModelName({ models: legacy })).toBe("Legacy A");
	});

	it("I258: legacy list + config option, no confirmation → the config option (what the picker writes)", () => {
		expect(deriveHeaderModelName({ models: legacy, configOptions: [modelOption] })).toBe(
			"Claude Opus 5.5",
		);
	});

	it("I258: a confirmed model wins while the selection it was confirmed under is unchanged", () => {
		expect(
			deriveHeaderModelName({
				confirmedModelId: "x-confirmed",
				confirmedUnder: "claude-opus-5.5",
				models: legacy,
				configOptions: [modelOption],
			}),
		).toBe("x-confirmed");
	});

	it("I258: all three sources, only the config option changed → the header follows it", () => {
		expect(
			deriveHeaderModelName({
				confirmedModelId: "x-confirmed",
				confirmedUnder: "older-pick",
				models: legacy,
				configOptions: [modelOption],
			}),
		).toBe("Claude Opus 5.5");
	});

	it("I258: legacy-only selection change drops a stale confirmation", () => {
		expect(
			deriveHeaderModelName({
				confirmedModelId: "x-confirmed",
				confirmedUnder: "older-pick",
				models: legacy,
			}),
		).toBe("Legacy A");
	});

	it("a confirmation with no stamp (no selection known at the time) still wins", () => {
		expect(deriveHeaderModelName({ confirmedModelId: "x-confirmed" })).toBe("x-confirmed");
	});

	it("I258: an unstamped confirmation goes stale once a selection appears", () => {
		expect(
			deriveHeaderModelName({ confirmedModelId: "x-confirmed", configOptions: [modelOption] }),
		).toBe("Claude Opus 5.5");
	});

	it("no model anywhere → null", () => {
		expect(deriveHeaderModelName({})).toBeNull();
	});
});

describe("ChatHeader agent segment", () => {
	// The header shows the agent in its grey extras (deriveHeaderExtras); a
	// configured agent appears there when the composer doesn't name it.
	const seg = (agent: HeaderSegments["agent"]): HeaderSegments => ({
		title: "Explain vector embeddings",
		titleIsDefault: false,
		extras: {
			agent:
				agent === undefined || agent.kind === "configured"
					? { kind: "label", label: "Team Agent" }
					: agent,
			model: null,
		},
		profile: "Team Agent",
		engine: { kind: "unknown" },
		model: "Claude Opus 5.5",
		effort: null,
		mode: null,
		folder: null,
		agent,
	});
	const renderHeader = (segments: HeaderSegments) =>
		render(
			<ChatHeader
				agentLabel="Team Agent"
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
			seg({ kind: "notLoaded", label: "Team Agent", running: "kiro_default" }),
		);
		const del = container.querySelector("del.acp-header-branded-profile");
		expect(del?.textContent).toBe("Team Agent");
		expect(container.querySelector(".acp-header-branded-running")?.textContent).toBe(
			"kiro_default",
		);
		// One tooltip only (INV-9): the title slot's aria-label carries it.
		const label = container
			.querySelector(".acp-header-branded")
			?.getAttribute("aria-label");
		expect(label).toContain("Team Agent");
		expect(label).toContain("kiro_default");
	});

	it("switched: no strikethrough, shows the running mode", () => {
		const { container } = renderHeader(
			seg({ kind: "switched", label: "Team Agent", running: "trd-pro" }),
		);
		expect(container.querySelector("del")).toBeNull();
		expect(container.querySelector(".acp-header-branded-running")?.textContent).toBe("trd-pro");
	});

	it("configured (or absent): the agent label, no strikethrough", () => {
		const { container } = renderHeader(seg(undefined));
		expect(container.querySelector("del")).toBeNull();
		expect(container.querySelector(".acp-header-branded-running")).toBeNull();
		expect(container.querySelector(".acp-header-branded-profile")?.textContent).toBe("Team Agent");
	});
});
