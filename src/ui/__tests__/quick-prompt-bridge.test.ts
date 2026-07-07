/**
 * quick-prompt-bridge.test.ts
 *
 * QP-I20: firing a quick prompt from a chip leaves DOM focus on the chip
 * button — `fireOrQueue` sent/queued the text but never returned focus to the
 * composer, so the caret didn't come back and you couldn't keep typing. Its
 * sibling `insertAtCursor` already refocuses; `fireOrQueue` did not.
 *
 * These tests exercise the REAL bridge factory against a live jsdom DOM (a
 * composer textarea inside a container, focus parked on a chip button), so they
 * assert the actual fire path — not a pure-function proxy (see
 * learned/skill-rules/agent-console.md § test the LIVE wiring).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	createQuickPromptBridge,
	type QuickPromptBridgeDeps,
} from "../quick-prompt-bridge";

/** Build a container with a composer textarea + a focused "chip" button. */
function mountComposerAndChip(): {
	container: HTMLDivElement;
	textarea: HTMLTextAreaElement;
	chip: HTMLButtonElement;
} {
	const container = document.createElement("div");
	const textarea = document.createElement("textarea");
	textarea.className = "agent-client-chat-input-textarea";
	container.appendChild(textarea);
	document.body.appendChild(container);

	const chip = document.createElement("button");
	document.body.appendChild(chip);
	chip.focus();
	return { container, textarea, chip };
}

function makeDeps(
	over: Partial<QuickPromptBridgeDeps> = {},
): QuickPromptBridgeDeps {
	return {
		getComposerText: () => "",
		getSelectionText: () => null,
		isSending: () => false,
		isSessionLive: () => true,
		isQueued: () => false,
		setComposerText: vi.fn(),
		queueMessage: vi.fn(),
		sendMessage: vi.fn(),
		openInNewTab: vi.fn(),
		getContainer: () => null,
		notify: vi.fn(),
		...over,
	};
}

describe("createQuickPromptBridge — fireOrQueue focus return (QP-I20)", () => {
	beforeEach(() => {
		// Run rAF callbacks synchronously so we can assert focus in-line.
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
			cb(0);
			return 0;
		});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = "";
	});

	it("send path: returns focus to the composer after firing from a chip", () => {
		const { container, textarea, chip } = mountComposerAndChip();
		expect(document.activeElement).toBe(chip); // fire starts with focus on the chip

		const sendMessage = vi.fn();
		const setComposerText = vi.fn();
		const bridge = createQuickPromptBridge(
			makeDeps({
				getContainer: () => container,
				sendMessage,
				setComposerText,
			}),
		);

		bridge.fireOrQueue("Debrief this meeting.");

		expect(setComposerText).toHaveBeenCalledWith(""); // cleared for the send
		expect(sendMessage).toHaveBeenCalledWith("Debrief this meeting.");
		// The bug: focus stayed on the chip. The fix returns it to the composer.
		expect(document.activeElement).toBe(textarea);
	});

	it("queue path: returns focus to the composer after queuing while streaming", () => {
		const { container, textarea } = mountComposerAndChip();

		const queueMessage = vi.fn();
		const setComposerText = vi.fn();
		const bridge = createQuickPromptBridge(
			makeDeps({
				getContainer: () => container,
				isSending: () => true, // streaming → queue slot
				isQueued: () => false,
				queueMessage,
				setComposerText,
			}),
		);

		bridge.fireOrQueue("Queued follow-up.");

		expect(setComposerText).toHaveBeenCalledWith("Queued follow-up.");
		expect(queueMessage).toHaveBeenCalledWith("Queued follow-up.");
		expect(document.activeElement).toBe(textarea);
	});

	it("defensive slot-full: does nothing and does not steal focus", () => {
		const { container, chip } = mountComposerAndChip();

		const queueMessage = vi.fn();
		const sendMessage = vi.fn();
		const bridge = createQuickPromptBridge(
			makeDeps({
				getContainer: () => container,
				isSending: () => true,
				isQueued: () => true, // slot already full
				queueMessage,
				sendMessage,
			}),
		);

		bridge.fireOrQueue("ignored");

		expect(queueMessage).not.toHaveBeenCalled();
		expect(sendMessage).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(chip); // untouched
	});
});

describe("createQuickPromptBridge — refactor fidelity", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = "";
	});

	it("insertAtCursor splices at the caret and focuses the composer", () => {
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
			cb(0);
			return 0;
		});
		const container = document.createElement("div");
		const textarea = document.createElement("textarea");
		textarea.className = "agent-client-chat-input-textarea";
		textarea.value = "ab";
		container.appendChild(textarea);
		document.body.appendChild(container);
		textarea.selectionStart = 1;
		textarea.selectionEnd = 1;

		const setComposerText = vi.fn();
		const bridge = createQuickPromptBridge(
			makeDeps({
				getComposerText: () => "ab",
				getContainer: () => container,
				setComposerText,
			}),
		);

		bridge.insertAtCursor("X");

		expect(setComposerText).toHaveBeenCalledWith("aXb");
		expect(document.activeElement).toBe(textarea);
	});

	it("newTab prompts route through openInNewTab, never the composer", () => {
		const openInNewTab = vi.fn();
		const sendMessage = vi.fn();
		const setComposerText = vi.fn();
		const bridge = createQuickPromptBridge(
			makeDeps({ openInNewTab, sendMessage, setComposerText }),
		);

		bridge.openInNewTab("New tab prompt", { send: true, foreground: true });

		expect(openInNewTab).toHaveBeenCalledWith("New tab prompt", {
			send: true,
			foreground: true,
		});
		expect(sendMessage).not.toHaveBeenCalled();
		expect(setComposerText).not.toHaveBeenCalled();
	});
});
