/**
 * ZeroTabLanding — the zero-tab landing launcher (Slice 3 of
 * [[Agent Console Close Last Tab to Empty State]]).
 *
 * Verifies the neutral resting screen is a live launcher, never a dead end:
 * the composer send and a fired quick prompt both call the launch callback
 * (wired in ChatView to spawn a tab on the default agent and send — Decision
 * 4), and the New chat / New chat with an agent actions are wired. The
 * composer starts blank.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import * as React from "react";

import { ZeroTabLanding } from "../ZeroTabLanding";
import type { QuickPrompt } from "../../types/quick-prompt";

afterEach(cleanup);

function makeProps(overrides: Partial<React.ComponentProps<typeof ZeroTabLanding>> = {}) {
	return {
		onSubmitPrompt: vi.fn(),
		quickPrompts: [] as QuickPrompt[],
		onFireQuickPrompt: vi.fn(),
		onNewChat: vi.fn(),
		onNewChatWithAgent: vi.fn(),
		onOpenHistory: vi.fn(),
		...overrides,
	};
}

function qp(overrides: Partial<QuickPrompt>): QuickPrompt {
	return {
		id: "id",
		label: "Label",
		body: "prompt body",
		path: "Quick Prompts/x.md",
		usesSelection: false,
		...overrides,
	};
}

describe("ZeroTabLanding — launcher composer", () => {
	it("renders a blank composer; Send is disabled until there is text", () => {
		const props = makeProps();
		const { container } = render(<ZeroTabLanding {...props} />);
		const input = container.querySelector(
			".agent-client-zero-tab-landing-input",
		) as HTMLTextAreaElement | null;
		const send = container.querySelector(
			".agent-client-zero-tab-landing-send",
		) as HTMLButtonElement | null;
		expect(input?.value).toBe("");
		expect(send?.disabled).toBe(true);
	});

	it("typing + Send launches with the typed text and clears the composer", () => {
		const props = makeProps();
		const { container } = render(<ZeroTabLanding {...props} />);
		const input = container.querySelector(
			".agent-client-zero-tab-landing-input",
		) as HTMLTextAreaElement;
		const send = container.querySelector(
			".agent-client-zero-tab-landing-send",
		) as HTMLButtonElement;

		fireEvent.change(input, { target: { value: "explain this repo" } });
		expect(send.disabled).toBe(false);
		fireEvent.click(send);

		expect(props.onSubmitPrompt).toHaveBeenCalledTimes(1);
		expect(props.onSubmitPrompt).toHaveBeenCalledWith("explain this repo");
		expect(input.value).toBe("");
	});

	it("Enter submits; Shift+Enter does not (newline)", () => {
		const props = makeProps();
		const { container } = render(<ZeroTabLanding {...props} />);
		const input = container.querySelector(
			".agent-client-zero-tab-landing-input",
		) as HTMLTextAreaElement;

		fireEvent.change(input, { target: { value: "hello" } });
		fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
		expect(props.onSubmitPrompt).not.toHaveBeenCalled();

		fireEvent.keyDown(input, { key: "Enter" });
		expect(props.onSubmitPrompt).toHaveBeenCalledWith("hello");
	});

	it("does not launch on empty/whitespace-only input", () => {
		const props = makeProps();
		const { container } = render(<ZeroTabLanding {...props} />);
		const input = container.querySelector(
			".agent-client-zero-tab-landing-input",
		) as HTMLTextAreaElement;
		fireEvent.change(input, { target: { value: "   " } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(props.onSubmitPrompt).not.toHaveBeenCalled();
	});
});

describe("ZeroTabLanding — quick prompts + actions", () => {
	it("renders quick-prompt chips and fires the prompt on click", () => {
		const props = makeProps({
			quickPrompts: [qp({ id: "brief", label: "Daily brief" })],
		});
		const { container } = render(<ZeroTabLanding {...props} />);
		const chip = container.querySelector(
			".agent-client-quick-prompt-chip",
		) as HTMLButtonElement | null;
		expect(chip).not.toBeNull();
		fireEvent.click(chip as HTMLButtonElement);
		expect(props.onFireQuickPrompt).toHaveBeenCalledTimes(1);
		expect(props.onFireQuickPrompt).toHaveBeenCalledWith(
			expect.objectContaining({ id: "brief" }),
		);
	});

	it("renders no chip row when there are no matching prompts", () => {
		const props = makeProps({ quickPrompts: [] });
		const { container } = render(<ZeroTabLanding {...props} />);
		expect(
			container.querySelector(".agent-client-quick-prompt-bar"),
		).toBeNull();
	});

	it("wires New chat, New chat with an agent, and Open session history", () => {
		const props = makeProps();
		const { container } = render(<ZeroTabLanding {...props} />);
		const actions = container.querySelectorAll(
			".agent-client-zero-tab-landing-action",
		);
		expect(actions.length).toBe(3);
		fireEvent.click(actions[0]);
		expect(props.onNewChat).toHaveBeenCalledTimes(1);
		fireEvent.click(actions[1]);
		expect(props.onNewChatWithAgent).toHaveBeenCalledTimes(1);
		fireEvent.click(actions[2]);
		expect(props.onOpenHistory).toHaveBeenCalledTimes(1);
	});
});
