/**
 * I80: the header must never be stuck on "Connecting…" for agents that never
 * report a model over ACP (e.g. Claude Code).
 *
 * Since [[Session Title in the Chat Header]] the header text shows no
 * lifecycle state at all: the chat title and grey extras only, never
 * "Connecting…" or "Not connected" (Decision 6; the tab's status icon shows
 * connecting and asleep). The I80 guard now lives in the tooltip: its Engine
 * and Model lines read "Connecting…" only while the session is genuinely
 * connecting (`isConnecting`), never on a ready session with no model.
 */

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";

import { ChatHeader } from "../ChatHeader";
import type { HeaderSegments } from "../ChatHeader";

// ============================================================================
// Mocks
// ============================================================================

// ChatHeader's NavActionButton + BrandedTitle use setIcon / ResizeObserver.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
	setTooltip: vi.fn(),
}));

// ============================================================================
// Fixtures
// ============================================================================

function makeSegments(overrides: Partial<HeaderSegments>): HeaderSegments {
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

function renderHeader(segments: HeaderSegments) {
	return render(
		<ChatHeader
			agentLabel="Claude Code"
			headerSegments={segments}
			isUpdateAvailable={false}
			onUpdateClick={vi.fn()}
			onReload={vi.fn()}
			onExportChat={vi.fn()}
			onShowMenu={vi.fn()}
		/>,
	);
}

const titleText = (c: HTMLElement) =>
	c.querySelector(".agent-client-chat-view-header-title")?.textContent ?? "";
const tooltipText = (c: HTMLElement) =>
	c.querySelector(".acp-header-branded")?.getAttribute("aria-label") ?? "";

// ============================================================================
// Tests
// ============================================================================

describe("I80: the header text never shows a connection placeholder", () => {
	it.each([
		["ready, no model (Claude Code)", { isConnecting: false }],
		["genuinely connecting", { isConnecting: true }],
		["ready, model present", { isConnecting: false, model: "claude-opus-4.7" }],
	] as const)("%s: no 'Connecting…' or 'Not connected' in the header text", (_name, o) => {
		const { container } = renderHeader(makeSegments(o));
		expect(titleText(container)).toContain("Debug the failing CI pipeline");
		expect(titleText(container)).not.toContain("Connecting");
		expect(titleText(container)).not.toContain("Not connected");
	});
});

describe("I80: the tooltip says 'Connecting…' only while connecting", () => {
	it("ready + no model: no 'Connecting…' and no Model line", () => {
		const { container } = renderHeader(makeSegments({ isConnecting: false }));
		expect(tooltipText(container)).not.toContain("Connecting");
		expect(tooltipText(container)).not.toContain("Model:");
	});

	it("genuinely connecting: Engine and Model read 'Connecting…'", () => {
		const { container } = renderHeader(makeSegments({ isConnecting: true }));
		expect(tooltipText(container)).toContain("Engine: Connecting…");
		expect(tooltipText(container)).toContain("Model: Connecting…");
	});

	it("ready + model present: the model, no placeholder", () => {
		const { container } = renderHeader(
			makeSegments({ isConnecting: false, model: "claude-opus-4.7" }),
		);
		expect(tooltipText(container)).toContain("Model: claude-opus-4.7");
		expect(tooltipText(container)).not.toContain("Connecting");
	});
});
