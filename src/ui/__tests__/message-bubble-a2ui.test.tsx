/**
 * MessageBubble × a2ui — the D11 wiring seam:
 *
 * - Assistant messages with closed a2ui fences render surface hosts as
 *   SIBLINGS of markdown segments (T01), only when an a2ui context is
 *   provided (feature wiring present).
 * - User messages containing an action fence render compactly: summary
 *   visible, canonical envelope behind a native disclosure (T02/D14).
 * - a2ui fences in USER messages never activate (T08) — user text never
 *   mounts a surface host.
 * - Without an a2ui context (other MessageBubble consumers), assistant
 *   fences stay ordinary markdown (T07 fallback by construction).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
	MarkdownRenderer: { render: vi.fn() },
	Component: class {},
	Platform: { isMacOS: true },
}));

vi.mock("../shared/MarkdownRenderer", async () => {
	const React = await import("react");
	return {
		MarkdownRenderer: (props: { text: string }) =>
			React.createElement(
				"div",
				{ className: "test-markdown" },
				props.text,
			),
	};
});

afterEach(cleanup);

import { MessageBubble, type A2uiBubbleContext } from "../MessageBubble";
import type { ChatMessage } from "../../types/chat";
import type AgentClientPlugin from "../../plugin";

const PLUGIN = {
	app: { workspace: { getActiveFile: () => null } },
} as unknown as AgentClientPlugin;

const ENVELOPE =
	'{"version":"v1.0","createSurface":{"surfaceId":"pick-1a2b","catalogId":"https://agentconsole.dev/a2ui/catalogs/buttons-v0","components":[{"id":"root","component":"Row","children":["b"]},{"id":"l","component":"Text","text":"Go"},{"id":"b","component":"Button","child":"l","action":{"event":{"name":"go","context":{"x":1}}}}]}}';
const ASSISTANT_TEXT = "Pick one:\n\n```a2ui\n" + ENVELOPE + "\n```\n\nOr type.";

const ACTION_TEXT =
	'Selected: Go\n\n```a2ui\n{"version":"v1.0","action":{"name":"go","surfaceId":"pick-1a2b","sourceComponentId":"b","timestamp":"2026-07-16T09:00:00Z","context":{"x":1}}}\n```';

function makeMessage(role: "user" | "assistant", text: string): ChatMessage {
	return {
		id: `${role}-1`,
		role,
		content: [{ type: "text", text }],
	} as ChatMessage;
}

function makeA2ui(
	overrides: Partial<A2uiBubbleContext> = {},
): A2uiBubbleContext {
	return {
		answers: new Map(),
		isFirstDefinition: () => true,
		isSending: false,
		isQueued: false,
		isRestoringSession: false,
		onActivate: vi.fn().mockResolvedValue(true),
		...overrides,
	};
}

describe("MessageBubble × a2ui — assistant messages", () => {
	it("mounts a surface host sibling for a closed fence when wired (T01)", () => {
		const { container } = render(
			<MessageBubble
				message={makeMessage("assistant", ASSISTANT_TEXT)}
				plugin={PLUGIN}
				a2ui={makeA2ui()}
				a2uiIsStreamingTurn={false}
			/>,
		);
		expect(
			container.querySelector(".agent-client-a2ui-surface"),
		).not.toBeNull();
		expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(1);
		// Markdown segments render around it.
		const markdown = Array.from(
			container.querySelectorAll(".test-markdown"),
		).map(
			(el) => el.textContent,
		);
		expect(markdown.join("\n")).toContain("Pick one:");
		expect(markdown.join("\n")).toContain("Or type.");
	});

	it("renders the fence as plain markdown when no a2ui context is wired (T07)", () => {
		const { container } = render(
			<MessageBubble
				message={makeMessage("assistant", ASSISTANT_TEXT)}
				plugin={PLUGIN}
			/>,
		);
		expect(container.querySelector(".agent-client-a2ui-surface")).toBeNull();
		expect(container.textContent).toContain(ENVELOPE);
	});

	it("keeps buttons disabled while this turn streams (T01 tail)", () => {
		render(
			<MessageBubble
				message={makeMessage("assistant", ASSISTANT_TEXT)}
				plugin={PLUGIN}
				a2ui={makeA2ui()}
				a2uiIsStreamingTurn={true}
			/>,
		);
		const surfaceButtons = screen
			.getAllByRole("button")
			.filter((b) => b.className.includes("a2ui"));
		expect(surfaceButtons.length).toBeGreaterThanOrEqual(1);
		for (const b of surfaceButtons) {
			expect((b as HTMLButtonElement).disabled).toBe(true);
		}
	});

	it("shows the answered state from the transcript-derived map (T05)", () => {
		render(
			<MessageBubble
				message={makeMessage("assistant", ASSISTANT_TEXT)}
				plugin={PLUGIN}
				a2ui={makeA2ui({ answers: new Map([["pick-1a2b", "b"]]) })}
				a2uiIsStreamingTurn={false}
			/>,
		);
		const chosen = screen
			.getAllByRole("button")
			.find((b) => b.className.includes("chosen"));
		expect(chosen).toBeDefined();
		expect((chosen as HTMLButtonElement).disabled).toBe(true);
	});
});

describe("MessageBubble × a2ui — user action messages (T02/T08/D14)", () => {
	it("never mounts a surface for fences in user messages (T08)", () => {
		const { container } = render(
			<MessageBubble
				message={makeMessage("user", ACTION_TEXT)}
				plugin={PLUGIN}
				a2ui={makeA2ui()}
			/>,
		);
		expect(container.querySelector(".agent-client-a2ui-surface")).toBeNull();
	});

	it("renders the action compactly: summary visible, envelope behind a disclosure (D14)", () => {
		const { container } = render(
			<MessageBubble
				message={makeMessage("user", ACTION_TEXT)}
				plugin={PLUGIN}
				a2ui={makeA2ui()}
			/>,
		);
		expect(container.textContent).toContain("Selected: Go");
		const details = container.querySelector(
			"details.agent-client-a2ui-action-details",
		);
		expect(details).not.toBeNull();
		// Payload-derived summary on the disclosure (name + context).
		const summary = details?.querySelector("summary");
		expect(summary?.textContent).toContain("go");
		expect(summary?.textContent).toContain("x: 1");
		// Canonical envelope preserved inside.
		expect(details?.textContent).toContain('"surfaceId":"pick-1a2b"');
	});

	it("leaves ordinary user messages untouched", () => {
		const { container } = render(
			<MessageBubble
				message={makeMessage("user", "just a normal message")}
				plugin={PLUGIN}
				a2ui={makeA2ui()}
			/>,
		);
		expect(container.querySelector("details")).toBeNull();
		expect(container.textContent).toContain("just a normal message");
	});
});
