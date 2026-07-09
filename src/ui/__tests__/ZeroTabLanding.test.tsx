/**
 * ZeroTabLanding — minimal zero-tab landing screen (Slice 1 of
 * [[Agent Console Close Last Tab to Empty State]]).
 *
 * Verifies the neutral resting screen shown when every tab is closed: it is
 * never a dead end (a "New chat" escape hatch is always present and wired),
 * and the control is a native, keyboard-activatable <button> (Keyboard-first
 * tenet). Slice 2 replaces the inner shell; this test guards the contract the
 * ChatView render branch depends on.
 */

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";

import { ZeroTabLanding } from "../ZeroTabLanding";

describe("ZeroTabLanding (zero-tab landing screen)", () => {
	it("renders the landing container with a message and a New chat button", () => {
		const { container } = render(
			<ZeroTabLanding onNewChat={vi.fn()} />,
		);

		const landing = container.querySelector(
			".agent-client-zero-tab-landing",
		);
		expect(landing).not.toBeNull();

		const message = container.querySelector(
			".agent-client-zero-tab-landing-message",
		);
		expect(message?.textContent).toContain("No chats open");

		const newChat = container.querySelector(
			".agent-client-zero-tab-landing-new-chat",
		) as HTMLButtonElement | null;
		expect(newChat?.textContent).toContain("New chat");
		// Native <button> → Enter/Space activation for free (Keyboard-first).
		expect(newChat?.tagName).toBe("BUTTON");
	});

	it("fires onNewChat when the New chat button is activated", () => {
		const onNewChat = vi.fn();
		const { container } = render(
			<ZeroTabLanding onNewChat={onNewChat} />,
		);
		const newChat = container.querySelector(
			".agent-client-zero-tab-landing-new-chat",
		) as HTMLButtonElement | null;
		newChat?.click();
		expect(onNewChat).toHaveBeenCalledTimes(1);
	});
});
