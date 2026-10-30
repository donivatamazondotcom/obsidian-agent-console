/**
 * I232 reproducing test: after a session fails to start (e.g. an expired
 * auth token), the tab sits in the `error` state and the Send button was
 * disabled with a "Connecting..." label — a dead end with nothing to click.
 * The retry path already exists (`decideQueuedSendKind("error")` holds the
 * message and re-acquires); only the button blocked it.
 *
 * Fixed behavior: in `error`, Send is enabled when there's content, labelled
 * "Retry connecting and send", and clicking it dispatches through the normal
 * send path. Broadcast/programmatic sends stay blocked (`canSend` false).
 *
 * [[I232 Send stays disabled as connecting after session creation fails]].
 * Red-first: the enabled + label cases fail against the unfixed code.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import * as React from "react";

import { InputToolbar } from "../InputToolbar";
import { deriveSendAffordance } from "../../resolvers/send-affordance";
import { decideQueuedSendKind } from "../../services/message-queue-logic";

vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
	setTooltip: vi.fn(),
	Platform: { isMacOS: true, isWin: false, isLinux: false },
}));

function errorAffordance(hasContent: boolean) {
	return deriveSendAffordance({
		lazyState: "error",
		isSending: false,
		isQueued: false,
		hasContent,
		isRestoringSession: false,
	});
}

function renderToolbar(isButtonDisabled: boolean, onSendOrStop = vi.fn()) {
	const { container } = render(
		<InputToolbar
			isSending={false}
			isButtonDisabled={isButtonDisabled}
			hasContent={true}
			lazyState="error"
			onSendOrStop={onSendOrStop}
			onModelChange={vi.fn()}
		/>,
	);
	const button = container.querySelector(
		".agent-client-chat-send-button",
	) as HTMLButtonElement;
	return { button, onSendOrStop };
}

describe("I232: Send is the retry after a failed session start", () => {
	it("enables Send in the error state when there is content", () => {
		expect(errorAffordance(true).buttonDisabled).toBe(false);
	});

	it("keeps broadcast / programmatic sends blocked in the error state", () => {
		expect(errorAffordance(true).canSend).toBe(false);
	});

	it("keeps Send disabled in the error state with an empty composer", () => {
		expect(errorAffordance(false).buttonDisabled).toBe(true);
	});

	it("labels the button 'Retry connecting and send', not 'Connecting...'", () => {
		const { button } = renderToolbar(errorAffordance(true).buttonDisabled);
		expect(button.getAttribute("aria-label")).toBe("Retry connecting and send");
	});

	it("clicking Send in the error state dispatches the send", () => {
		const { button, onSendOrStop } = renderToolbar(
			errorAffordance(true).buttonDisabled,
		);
		fireEvent.click(button);
		expect(onSendOrStop).toHaveBeenCalledTimes(1);
	});

	it("a send from the error state holds the message and reconnects (existing path)", () => {
		expect(decideQueuedSendKind("error")).toBe("sendWhilePreReady");
	});
});
