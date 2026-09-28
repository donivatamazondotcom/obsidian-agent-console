/**
 * Send now on the locked composer — rendered at the real InputArea seam.
 *
 * Asserts what the user sees and triggers: the banner offers Send now only
 * when the session is live, clicking it (or the steer key combo on the locked
 * composer) calls onSendQueuedNow, and ChatPanel actually wires the prop.
 * The wiring guard exists because A2UI-I08 shipped a declared-but-unpassed
 * prop that every unit test missed.
 */

import { describe, expect, it, vi, beforeAll, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import * as React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { InputArea, type InputAreaProps } from "../InputArea";
import type AgentClientPlugin from "../../plugin";
import type { IChatViewHost } from "../view-host";
import type { UseSuggestionsReturn } from "../../hooks/useSuggestions";

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

function closedSuggestions(): UseSuggestionsReturn {
	const closed = {
		isOpen: false,
		suggestions: [] as unknown[],
		selectedIndex: 0,
		createRow: null,
		updateSuggestions: () => undefined,
		close: () => undefined,
		selectSuggestion: (v: string) => ({ newText: v, newCursorPos: v.length }),
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
		lazyState: "connecting",
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
		inputValue: "DRAFT-MUST-SURVIVE",
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

function bannerOf(container: HTMLElement): {
	text: string | null;
	actions: string[];
} {
	return {
		text:
			container.querySelector(".agent-client-queued-banner-text")
				?.textContent ?? null,
		actions: Array.from(
			container.querySelectorAll(
				".agent-client-queued-banner-actions button",
			),
		).map((b) => b.textContent ?? ""),
	};
}

describe("InputArea — Send now on the queued banner", () => {
	it("live session: banner offers Send now, Edit, Delete (in that order)", () => {
		const { container } = render(
			<InputArea
				{...baseProps({
					isQueued: true,
					isSessionReady: true,
					lazyState: "busy",
					isSending: true,
					isStreaming: true,
				})}
			/>,
		);
		expect(bannerOf(container).actions).toEqual(["Send now", "Edit", "Delete"]);
	});

	it("still connecting: no Send now (it sends on connect anyway)", () => {
		const { container } = render(
			<InputArea {...baseProps({ isQueued: true })} />,
		);
		expect(bannerOf(container).actions).toEqual(["Edit", "Delete"]);
	});

	it("clicking Send now calls onSendQueuedNow", () => {
		const onSendQueuedNow = vi.fn();
		const { container } = render(
			<InputArea
				{...baseProps({
					isQueued: true,
					isSessionReady: true,
					lazyState: "busy",
					isSending: true,
					isStreaming: true,
					onSendQueuedNow,
				})}
			/>,
		);
		const btn = container.querySelector<HTMLButtonElement>(
			".agent-client-queued-send-now",
		);
		expect(btn).not.toBeNull();
		expect(btn?.tagName).toBe("BUTTON");
		fireEvent.click(btn as HTMLButtonElement);
		expect(onSendQueuedNow).toHaveBeenCalledTimes(1);
	});

	it("steer key combo on the locked composer calls onSendQueuedNow", () => {
		const onSendQueuedNow = vi.fn();
		const onSteerMessage = vi.fn();
		const { container } = render(
			<InputArea
				{...baseProps({
					isQueued: true,
					isSessionReady: true,
					lazyState: "busy",
					isSending: true,
					isStreaming: true,
					onSendQueuedNow,
					onSteerMessage,
				})}
			/>,
		);
		const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
		// enter mode → steer is Mod+Enter (both meta and ctrl count as Mod).
		fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
		expect(onSendQueuedNow).toHaveBeenCalledTimes(1);
		expect(onSteerMessage).not.toHaveBeenCalled();
	});
});

describe("Send now wiring guard — ChatPanel forwards onSendQueuedNow", () => {
	it("passes the handler into InputArea and dispatches sendQueuedNow", () => {
		const source = readFileSync(
			resolve(process.cwd(), "src/ui/ChatPanel.tsx"),
			"utf8",
		);
		expect(source).toMatch(/onSendQueuedNow=\{/);
		expect(source).toMatch(/type: "sendQueuedNow"/);
	});
});
