/**
 * I302 §5: the header tooltip says why a Default Kiro tab runs V2 – the
 * kiro-cli is too old for V3 – so the reason stays one hover away after the
 * update tip is dismissed. The reason shows only while the tab runs V2.
 *
 * Seams (R2): the pure `deriveHeaderEngine` fed from session fields, and the
 * rendered ChatHeader tooltip text the user hovers (R3). Obsidian stub only
 * (R4). Literal expectations (R5).
 *
 * Red-first (R1): on main the resolver has no reason and the tooltip says
 * only "Kiro CLI V2 (legacy)".
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";
import { ChatHeader, type HeaderSegments } from "../ChatHeader";
import { deriveHeaderEngine } from "../../resolvers/header-agent";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
vi.mock("obsidian", () => ({ setIcon: vi.fn(), setTooltip: vi.fn() }));

function tooltipFor(engine: HeaderSegments["engine"]): string[] {
	const segments = {
		plugin: "Agent Console",
		profile: "Kiro CLI",
		engine,
		model: null,
		effort: null,
		mode: null,
		folder: null,
		isConnecting: false,
	} as unknown as HeaderSegments;
	const { container } = render(
		<ChatHeader
			agentLabel="Kiro CLI"
			headerSegments={segments}
			isUpdateAvailable={false}
			onUpdateClick={vi.fn()}
			onReload={vi.fn()}
			onExportChat={vi.fn()}
			onShowMenu={vi.fn()}
		/>,
	);
	const tip =
		container.querySelector(".acp-header-branded")?.getAttribute("aria-label") ?? "";
	return tip.split("\n");
}

describe("I302 deriveHeaderEngine: the old-CLI reason", () => {
	it("a fallback V2 tab carries the reason", () => {
		expect(
			deriveHeaderEngine({ kiroCli: true, kiroEngine: "v2", kiroEngineFallback: "old-cli" }),
		).toEqual({ kind: "kiroCli", engine: "v2", reason: "old-cli" });
	});

	it("V3 never carries it, even with a stale fallback", () => {
		expect(
			deriveHeaderEngine({ kiroCli: true, kiroEngine: "v3", kiroEngineFallback: "old-cli" }),
		).toEqual({ kind: "kiroCli", engine: "v3" });
	});

	it("a V2 picked by name has no reason", () => {
		expect(deriveHeaderEngine({ kiroCli: true, kiroEngine: "v2" })).toEqual({
			kind: "kiroCli",
			engine: "v2",
		});
	});
});

describe("I302 header tooltip text", () => {
	it("says the CLI is too old for V3", () => {
		expect(tooltipFor({ kind: "kiroCli", engine: "v2", reason: "old-cli" })).toEqual([
			"Agent: Kiro CLI",
			"Engine: Kiro CLI V2 (legacy) – this Kiro CLI is too old for V3",
		]);
	});

	it("a plain V2 tab is unchanged", () => {
		expect(tooltipFor({ kind: "kiroCli", engine: "v2" })).toEqual([
			"Agent: Kiro CLI",
			"Engine: Kiro CLI V2 (legacy)",
		]);
	});
});
