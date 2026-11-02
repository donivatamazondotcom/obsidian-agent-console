/**
 * I247: the header tooltip names things the way the settings do, names the
 * engine on V2 as well as V3, and leaves out lines that don't apply.
 *
 * Before: "Plugin: Agent Console" (repeats the visible header), "Profile:"
 * (the settings say agent), and no engine line on a Kiro V2 tab.
 * After: Agent / Engine / Model / Effort / Mode / Folder, each shown only
 * when it applies.
 *
 * Seam (R2): the rendered ChatHeader's tooltip (`aria-label`), the string
 * the user actually hovers. Segments are the shape ChatPanel builds from its
 * resolvers. Assertions are on that text (R3). No mocks beyond the Obsidian
 * stub (R4). Expected strings are literals (R5).
 *
 * Red-first (R1): on main the tooltip starts with "Plugin:" and "Profile:",
 * ignores the engine/effort/mode/folder segments, and every case fails.
 *
 * Spec: [[I247 Header tooltip uses internal terms and omits the V2 engine]].
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";
import { ChatHeader, type HeaderSegments } from "../ChatHeader";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
const h = vi.hoisted(() => ({ setTooltip: vi.fn() }));
vi.mock("obsidian", () => ({ setIcon: vi.fn(), setTooltip: h.setTooltip }));

function renderHeader(overrides: Record<string, unknown>) {
	const segments = {
		plugin: "Agent Console",
		profile: "Auto SA",
		engine: { kind: "unknown" },
		model: null,
		effort: null,
		mode: null,
		folder: null,
		isConnecting: false,
		...overrides,
	} as unknown as HeaderSegments;
	const { container } = render(
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
	return container;
}

/** The tooltip is on the header TEXT, so it opens next to it (I247 smoke H4). */
function tooltipFor(overrides: Record<string, unknown>): string[] {
	const tip =
		renderHeader(overrides)
			.querySelector(".acp-header-branded")
			?.getAttribute("aria-label") ?? "";
	return tip.split("\n");
}

describe("I247 header tooltip lines", () => {
	it("Kiro V2 tab: Agent, Engine (V2), Model – no Plugin or Profile", () => {
		expect(
			tooltipFor({
				engine: { kind: "kiroCli", engine: "v2" },
				model: "claude-opus-4.8",
			}),
		).toEqual([
			"Agent: Auto SA",
			"Engine: Kiro CLI V2 (legacy)",
			"Model: claude-opus-4.8",
		]);
	});

	it("Kiro V3 tab with effort", () => {
		expect(
			tooltipFor({
				engine: { kind: "kiroCli", engine: "v3" },
				model: "claude-opus-5.5",
				effort: "High",
			}),
		).toEqual([
			"Agent: Auto SA",
			"Engine: Kiro CLI V3",
			"Model: claude-opus-5.5",
			"Effort: High",
		]);
	});

	it("Claude tab: reported engine, mode and a non-vault folder", () => {
		expect(
			tooltipFor({
				profile: "Claude Code",
				engine: { kind: "reported", label: "Claude Agent 0.57.0" },
				model: "Sonnet",
				mode: "Plan Mode",
				folder: "/Users/me/project",
			}),
		).toEqual([
			"Agent: Claude Code",
			"Engine: Claude Agent 0.57.0",
			"Model: Sonnet",
			"Mode: Plan Mode",
			"Folder: /Users/me/project",
		]);
	});

	it("nothing reported once ready: only the Agent line", () => {
		expect(tooltipFor({})).toEqual(["Agent: Auto SA"]);
	});

	it("connecting: Engine and Model say Connecting…, Effort and Mode stay hidden", () => {
		expect(
			tooltipFor({ isConnecting: true, folder: "/Users/me/project" }),
		).toEqual([
			"Agent: Auto SA",
			"Engine: Connecting…",
			"Model: Connecting…",
			"Folder: /Users/me/project",
		]);
	});

	it("I207 status line stays right under the Agent line", () => {
		const lines = tooltipFor({
			engine: { kind: "kiroCli", engine: "v3" },
			agent: { kind: "notLoaded", label: "Auto SA", running: "Default" },
		});
		expect(lines.slice(0, 3)).toEqual([
			"Agent: Auto SA",
			"Auto SA couldn't load, so Default is running instead",
			"Engine: Kiro CLI V3",
		]);
	});

	// Smoke H4 (2026-11-02): the tooltip opened far from the pointer because
	// it hung off the full-width title slot, and its text was centered.
	it("tooltip sits on the header text, not the full-width slot", () => {
		const container = renderHeader({ engine: { kind: "kiroCli", engine: "v3" } });
		expect(
			container.querySelector(".agent-client-chat-view-header-title")?.hasAttribute("aria-label"),
		).toBe(false);
		expect(container.querySelector(".acp-header-branded")?.getAttribute("aria-label")).toBe(
			"Agent: Auto SA\nEngine: Kiro CLI V3",
		);
	});

	it("tooltip opens below the text with the left-aligned header class", () => {
		h.setTooltip.mockClear();
		const container = renderHeader({ engine: { kind: "kiroCli", engine: "v3" } });
		const target = container.querySelector(".acp-header-branded");
		const call = h.setTooltip.mock.calls.find((c) => c[0] === target);
		expect(call?.[1]).toBe("Agent: Auto SA\nEngine: Kiro CLI V3");
		expect(call?.[2]).toEqual({ placement: "bottom", classes: ["acp-header-tooltip"] });
	});
});
