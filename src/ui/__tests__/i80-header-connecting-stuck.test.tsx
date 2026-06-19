/**
 * I80 reproducing test: header stuck on "Connecting…" for agents that never
 * report a model over ACP (e.g. Claude Code).
 *
 * ChatHeader decides the "Connecting…" placeholder from `model == null`
 * (`showConnectingPlaceholder = !model && !isLazyIdle`). For kiro-cli this is
 * fine — `session/models` populates once ready, so `model` becomes non-null.
 * But Claude Code never sends `session/models`, so `model` stays null even
 * after the session is `ready` and the agent has responded — leaving the
 * header permanently on "Connecting…".
 *
 * The header must instead gate the placeholder on the genuine connecting
 * signal (`isConnecting`), not on model-metadata presence. This mirrors the
 * I40 fix (idle vs actually-connecting) but for the header secondary slot.
 *
 * Against the unfixed code, the "ready, no model" case below renders
 * "Connecting…" and the assertion fails.
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
}));

// ============================================================================
// Fixtures
// ============================================================================

function makeSegments(overrides: Partial<HeaderSegments>): HeaderSegments {
	return {
		plugin: "Agent Console",
		profile: "Claude Code",
		runtime: null,
		model: null,
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

// ============================================================================
// Tests
// ============================================================================

describe("I80: header should not show 'Connecting…' once session is ready", () => {
	it("ready + no model (Claude Code): shows no 'Connecting…' placeholder", () => {
		const { container } = renderHeader(
			makeSegments({ isLazyIdle: false, isConnecting: false }),
		);
		const title = container.querySelector(
			".agent-client-chat-view-header-title",
		);
		expect(title?.textContent).toContain("Claude Code"); // profile still shown
		expect(title?.textContent).not.toContain("Connecting");
		expect(title?.textContent).not.toContain("Not connected");
	});

	it("genuinely connecting + no model: shows 'Connecting…'", () => {
		const { container } = renderHeader(
			makeSegments({ isLazyIdle: false, isConnecting: true }),
		);
		const title = container.querySelector(
			".agent-client-chat-view-header-title",
		);
		expect(title?.textContent).toContain("Connecting");
	});

	it("idle (lazy) tab: shows 'Not connected', never 'Connecting…'", () => {
		const { container } = renderHeader(
			makeSegments({ isLazyIdle: true, isConnecting: false }),
		);
		const title = container.querySelector(
			".agent-client-chat-view-header-title",
		);
		expect(title?.textContent).toContain("Not connected");
		expect(title?.textContent).not.toContain("Connecting");
	});

	it("ready + model present: shows the model, no placeholder", () => {
		const { container } = renderHeader(
			makeSegments({
				model: "claude-opus-4.7",
				isLazyIdle: false,
				isConnecting: false,
			}),
		);
		const title = container.querySelector(
			".agent-client-chat-view-header-title",
		);
		expect(title?.textContent).toContain("claude-opus-4.7");
		expect(title?.textContent).not.toContain("Connecting");
	});
});
