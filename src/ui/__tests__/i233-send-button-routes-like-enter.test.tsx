/**
 * I233 — the Send BUTTON must make the same decision as Enter. With no live
 * session (idle / connecting / error), a click QUEUES the composer text via
 * onQueueMessage and leaves it in the composer (locked), so Edit after a
 * failed start gives the text back. Before the fix the button called
 * onSendMessage after clearing the composer, and Edit restored nothing.
 *
 * Also: the held message's banner must not promise "sends when ready" once
 * the session start has failed — nothing will retry it.
 *
 * [[I233 Send button clears the composer before a pre-ready queue so Edit loses the message]].
 * Red-first: the not-ready button cases and the error banner fail before the fix.
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

function makePlugin(): AgentClientPlugin {
	return {
		settings: { displaySettings: { showEmojis: false } },
		settingsService: {
			subscribe: () => () => {},
			getSnapshot: () => settingsSnapshot,
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


function clickSend(container: HTMLElement) {
	const button = container.querySelector(
		".agent-client-chat-send-button",
	) as HTMLButtonElement;
	expect(button).not.toBeNull();
	fireEvent.click(button);
}

describe("I233: Send button routes like Enter", () => {
	for (const lazyState of ["idle", "connecting", "error"] as const) {
		it(`${lazyState}: a click queues and keeps the composer text`, async () => {
			const onSendMessage = vi.fn(async () => undefined);
			const onQueueMessage = vi.fn();
			const onInputChange = vi.fn();
			const { container } = render(
				<InputArea
					{...baseProps({
						isSessionReady: false,
						lazyState,
						onSendMessage,
						onQueueMessage,
						onInputChange,
					})}
				/>,
			);
			await act(async () => {
				clickSend(container);
			});
			expect(onQueueMessage).toHaveBeenCalledWith("explain this repo", []);
			expect(onSendMessage).not.toHaveBeenCalled();
			expect(onInputChange).not.toHaveBeenCalledWith("");
		});
	}

	it("ready: a click still sends and clears the composer (regression guard)", async () => {
		const onSendMessage = vi.fn(async () => undefined);
		const onQueueMessage = vi.fn();
		const onInputChange = vi.fn();
		const { container } = render(
			<InputArea
				{...baseProps({
					isSessionReady: true,
					lazyState: "ready",
					onSendMessage,
					onQueueMessage,
					onInputChange,
				})}
			/>,
		);
		await act(async () => {
			clickSend(container);
		});
		expect(onSendMessage).toHaveBeenCalledWith("explain this repo", undefined);
		expect(onQueueMessage).not.toHaveBeenCalled();
		expect(onInputChange).toHaveBeenCalledWith("");
	});

	it("launcher (no session): a click still dispatches onSendMessage", async () => {
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
			clickSend(container);
		});
		expect(onSendMessage).toHaveBeenCalled();
		expect(onQueueMessage).not.toHaveBeenCalled();
	});
});

describe("I233: queued banner after a failed start", () => {
	it("says the connection failed instead of 'sends when ready'", () => {
		const { container } = render(
			<InputArea
				{...baseProps({
					isSessionReady: false,
					lazyState: "error",
					isQueued: true,
				})}
			/>,
		);
		const text = container.querySelector(".agent-client-queued-banner-text")?.textContent;
		expect(text).toBe("Couldn't connect — Edit, then Send to retry");
	});

	it("still says 'sends when ready' while connecting (regression guard)", () => {
		const { container } = render(
			<InputArea
				{...baseProps({
					isSessionReady: false,
					lazyState: "connecting",
					isQueued: true,
				})}
			/>,
		);
		const text = container.querySelector(".agent-client-queued-banner-text")?.textContent;
		expect(text).toBe("Queued — sends when ready");
	});
});
