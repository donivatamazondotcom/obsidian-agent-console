/**
 * InputArea — LIVE-wiring test for the launcher Enter path (I169).
 *
 * Renders the REAL InputArea (no mock) and exercises the actual `handleKeyDown`
 * → `decideComposerEnterAction` seam, per the learned rule "test the LIVE
 * wiring, not just the pure function." The pure decision is covered
 * exhaustively in message-queue-logic.test.ts; this file proves InputArea
 * actually FORWARDS the `launches` prop into that decision — the seam a
 * pure-function test can't see, and the exact seam where I169 lived (Enter
 * returned "queue" and no-oped because the launcher's send target was implicit).
 *
 * Two cases:
 *  - Launcher (launches:true, no session): Enter DISPATCHES → onSendMessage
 *    (→ the landing's launch). The fix.
 *  - In-tab connecting (launches:false, not ready, onQueueMessage present):
 *    Enter QUEUES → onQueueMessage, NOT onSendMessage. Regression guard: the
 *    lazy send-while-connecting path is unchanged.
 */

import { describe, expect, it, vi, beforeAll, afterEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import * as React from "react";

import { InputArea, type InputAreaProps } from "../InputArea";
import type AgentClientPlugin from "../../plugin";
import type { IChatViewHost } from "../view-host";
import type { UseSuggestionsReturn } from "../../hooks/useSuggestions";

// InputArea installs an IntersectionObserver in an effect; jsdom lacks it.
beforeAll(() => {
	class IO {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	(window as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
		IO;
});

afterEach(cleanup);

// Stable snapshot — useSyncExternalStore requires getSnapshot to be cached.
const settingsSnapshot = { sendMessageShortcut: "enter" };

const cmdEnterSnapshot = { sendMessageShortcut: "cmd-enter" };

function makePlugin(snapshot: { sendMessageShortcut: string } = settingsSnapshot): AgentClientPlugin {
	return {
		settings: { displaySettings: { showEmojis: false } },
		settingsService: {
			subscribe: () => () => {},
			getSnapshot: () => snapshot,
		},
		app: { vault: { getConfig: () => true } },
	} as unknown as AgentClientPlugin;
}

/** All pickers closed — the composer is a plain textarea for these tests. */
function closedSuggestions(): UseSuggestionsReturn {
	const closed = {
		isOpen: false,
		suggestions: [] as unknown[],
		selectedIndex: 0,
		createRow: null,
		updateSuggestions: () => undefined,
		close: () => undefined,
		selectSuggestion: (v: string) => ({
			newText: v,
			newCursorPos: v.length,
		}),
	};
	return {
		mentions: closed,
		commands: closed,
		quickPrompts: closed,
		activePicker: null,
	} as unknown as UseSuggestionsReturn;
}

function baseProps(overrides: Partial<InputAreaProps>): InputAreaProps {
	return {
		isSending: false,
		isSessionReady: false,
		lazyState: "idle",
		isRestoringSession: false,
		agentLabel: "Claude Code",
		availableCommands: [],
		restoredMessage: null,
		suggestions: closedSuggestions(),
		plugin: makePlugin(),
		view: {} as IChatViewHost,
		onSendMessage: vi.fn(async () => undefined),
		onStopGeneration: vi.fn(async () => undefined),
		onRestoredMessageConsumed: () => undefined,
		supportsImages: false,
		imageCapabilityKnown: true,
		agentId: "claude-code-acp",
		inputValue: "explain this repo",
		onInputChange: () => undefined,
		attachedFiles: [],
		onAttachedFilesChange: () => undefined,
		errorInfo: null,
		onClearError: () => undefined,
		agentUpdateNotification: null,
		onClearAgentUpdate: () => undefined,
		messages: [],
		isActive: true,
		...overrides,
	};
}

function pressEnter(container: HTMLElement) {
	const textarea = container.querySelector(
		"textarea.agent-client-chat-input-textarea",
	) as HTMLTextAreaElement;
	expect(textarea).not.toBeNull();
	fireEvent.keyDown(textarea, { key: "Enter" });
}

describe("InputArea — launcher Enter path (I169 live wiring)", () => {
	it("launches:true + no session → Enter dispatches onSendMessage", async () => {
		const onSendMessage = vi.fn(async () => undefined);
		const onQueueMessage = vi.fn();
		const { container } = render(
			<InputArea
				{...baseProps({
					launches: true,
					isSessionReady: false,
					lazyState: "idle",
					onSendMessage,
					onQueueMessage,
				})}
			/>,
		);
		await act(async () => {
			pressEnter(container);
		});
		expect(onSendMessage).toHaveBeenCalledWith("explain this repo", undefined);
		expect(onQueueMessage).not.toHaveBeenCalled();
	});

	it("launches:false (in-tab) + connecting → Enter queues, does NOT send (regression guard)", async () => {
		const onSendMessage = vi.fn(async () => undefined);
		const onQueueMessage = vi.fn();
		const { container } = render(
			<InputArea
				{...baseProps({
					// launches omitted → defaults false (in-tab composer)
					isSessionReady: false,
					lazyState: "connecting",
					onSendMessage,
					onQueueMessage,
				})}
			/>,
		);
		await act(async () => {
			pressEnter(container);
		});
		expect(onQueueMessage).toHaveBeenCalledTimes(1);
		expect(onSendMessage).not.toHaveBeenCalled();
	});
});

// ============================================================================
// I358: a held Enter acts in the composer only if its press started there.
// fireEvent returns false when the keydown's default was prevented.
// ============================================================================
const composerOf = (c: HTMLElement) =>
	c.querySelector("textarea.agent-client-chat-input-textarea") as HTMLTextAreaElement;

describe("InputArea — held Enter (I358)", () => {
	it("T12: a fresh Enter sends once; its repeat doesn't send again", async () => {
		const onSendMessage = vi.fn(async () => undefined);
		const { container } = render(
			<InputArea {...baseProps({ launches: true, onSendMessage })} />,
		);
		const textarea = composerOf(container);
		textarea.focus();
		await act(async () => {
			fireEvent.keyDown(textarea, { key: "Enter" });
		});
		let notPrevented = true;
		await act(async () => {
			notPrevented = fireEvent.keyDown(textarea, { key: "Enter", repeat: true });
		});
		expect(onSendMessage).toHaveBeenCalledTimes(1);
		expect(notPrevented).toBe(false);
	});

	it("T12a: a repeat whose press started elsewhere (the pill) doesn't send", async () => {
		const onSendMessage = vi.fn(async () => undefined);
		const { container } = render(
			<InputArea {...baseProps({ launches: true, onSendMessage })} />,
		);
		const textarea = composerOf(container);
		textarea.focus();
		let notPrevented = true;
		await act(async () => {
			notPrevented = fireEvent.keyDown(textarea, { key: "Enter", repeat: true });
		});
		expect(onSendMessage).not.toHaveBeenCalled();
		expect(notPrevented).toBe(false);
	});

	it("T12b: Cmd+Enter mode – a foreign repeat is prevented (no newline); repeats of a press that started here aren't", () => {
		const { container } = render(
			<InputArea {...baseProps({ plugin: makePlugin(cmdEnterSnapshot) })} />,
		);
		const textarea = composerOf(container);
		textarea.focus();
		// jsdom never inserts text on keydown, so defaultPrevented is the assertion.
		expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: true })).toBe(false);
		expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(true);
		expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: true })).toBe(true);
		expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: true })).toBe(true);
	});

	it("T12d: focus leaving or arriving between the press and the repeat drops the repeat", () => {
		const { container } = render(
			<InputArea {...baseProps({ plugin: makePlugin(cmdEnterSnapshot) })} />,
		);
		const textarea = composerOf(container);
		textarea.focus();
		// Blur between the press and the repeat.
		expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(true);
		act(() => textarea.blur());
		act(() => textarea.focus());
		expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: true })).toBe(false);
		// A focus event alone (no blur seen) also clears it.
		expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(true);
		fireEvent.focus(textarea);
		expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: true })).toBe(false);
		// Enter keyup ends the press.
		expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(true);
		fireEvent.keyUp(textarea, { key: "Enter" });
		expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: true })).toBe(false);
	});
});
