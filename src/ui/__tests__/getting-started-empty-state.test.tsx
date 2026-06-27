/**
 * T5 — Layer 2 getting-started empty state.
 *
 * When the panel is a potential dead end (chat empty, current agent not
 * connectable), MessageList renders a getting-started block instead of the
 * plain "Connecting..." text: detected agents as one-click picks, an
 * "Open settings" button, and a manual-path hint. When no agent is detected,
 * it still offers the settings escape hatch (never a blank dead end).
 *
 * See [[Agent Console Command Palette Rationalization]] § First-run / onboarding.
 */

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";

import { MessageList } from "../MessageList";
import type { IChatViewHost } from "../view-host";
import type AgentClientPlugin from "../../plugin";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
	MarkdownRenderer: { render: vi.fn() },
	Component: class {},
	Platform: { isMobile: false },
}));

vi.mock("../MessageBubble", () => ({
	MessageBubble: () => <div data-testid="bubble" />,
}));

function makeView(): IChatViewHost {
	return { registerDomEvent: vi.fn() } as unknown as IChatViewHost;
}
function makePlugin(): AgentClientPlugin {
	return {} as AgentClientPlugin;
}

describe("T5: getting-started empty state (Layer 2)", () => {
	it("renders detected agents as one-click picks plus an open-settings button", () => {
		const onPickAgent = vi.fn();
		const onOpenSettings = vi.fn();
		const { container } = render(
			<MessageList
				messages={[]}
				isSending={false}
				lazyState="connecting"
				isRestoringSession={false}
				agentLabel="Kiro CLI"
				plugin={makePlugin()}
				view={makeView()}
				hasActivePermission={false}
				gettingStarted={{
					detectedAgents: [
						{ id: "kiro-cli", displayName: "Kiro CLI" },
						{ id: "codex-acp", displayName: "Codex" },
					],
					onPickAgent,
					onOpenSettings,
				}}
			/>,
		);

		// Plain connecting text is NOT shown — the panel is not a dead end.
		const emptyState = container.querySelector(
			".agent-client-chat-empty-state",
		);
		expect(emptyState?.textContent).not.toContain("Connecting to");

		// One-click picks present and wired.
		const picks = container.querySelectorAll(
			".agent-client-getting-started-pick",
		);
		expect(picks.length).toBe(2);
		(picks[0] as HTMLButtonElement).click();
		expect(onPickAgent).toHaveBeenCalledWith("kiro-cli");

		// Open-settings escape hatch present and wired.
		const settingsBtn = container.querySelector(
			".agent-client-getting-started-settings",
		) as HTMLButtonElement | null;
		expect(settingsBtn?.textContent).toContain("Open settings");
		settingsBtn?.click();
		expect(onOpenSettings).toHaveBeenCalledTimes(1);
	});

	it("offers the settings escape hatch even when no agent is detected", () => {
		const { container } = render(
			<MessageList
				messages={[]}
				isSending={false}
				lazyState="connecting"
				isRestoringSession={false}
				agentLabel="Claude Code"
				plugin={makePlugin()}
				view={makeView()}
				hasActivePermission={false}
				gettingStarted={{
					detectedAgents: [],
					onPickAgent: vi.fn(),
					onOpenSettings: vi.fn(),
				}}
			/>,
		);

		expect(
			container.querySelectorAll(".agent-client-getting-started-pick")
				.length,
		).toBe(0);
		// Still not a dead end — settings button is always offered.
		expect(
			container.querySelector(
				".agent-client-getting-started-settings",
			)?.textContent,
		).toContain("Open settings");
	});

	it("falls back to the normal connecting text when gettingStarted is absent", () => {
		const { container } = render(
			<MessageList
				messages={[]}
				isSending={false}
				lazyState="connecting"
				isRestoringSession={false}
				agentLabel="Kiro CLI"
				plugin={makePlugin()}
				view={makeView()}
				hasActivePermission={false}
			/>,
		);
		const emptyState = container.querySelector(
			".agent-client-chat-empty-state",
		);
		expect(emptyState?.textContent).toContain("Connecting to Kiro CLI");
		expect(
			container.querySelector(".agent-client-getting-started-pick"),
		).toBeNull();
	});
});
