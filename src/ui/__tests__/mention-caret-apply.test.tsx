/**
 * InputArea — LIVE-wiring test for the mention-selection caret (reported bug).
 *
 * Reproduces: editing a prompt mid-composer, referencing a note with `@`, then
 * selecting it moved the caret to the END of the whole composer text instead of
 * staying at the end of the inserted reference. Per the learned rule "test the
 * LIVE wiring, not just the pure function," this renders the REAL InputArea and
 * exercises the actual popup-select → `selectMention` → `setTextAndFocus` seam.
 *
 * Red-first (R1): against the old code — `setTextAndFocus` hardcoded
 * `cursorPos = newText.length` and `selectMention` discarded the picker's
 * `newCursorPos` — the caret lands at 12 (end of text). The fix threads
 * `newCursorPos` (10, right after `]]`).
 */
import { describe, expect, it, vi, beforeAll, afterEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import * as React from "react";

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
	(
		window as unknown as { IntersectionObserver: unknown }
	).IntersectionObserver = IO;
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

// The final composed text after selecting the note, and the intended caret:
// "a @[[Doc]] b" — the reference occupies indices 2..9, so end-of-reference is
// position 10 (right after "]]"), which is STRICTLY BEFORE end-of-text (12).
const NEW_TEXT = "a @[[Doc]] b";
const END_OF_REFERENCE = 10;

/** Mention picker open with one note; selectSuggestion returns the threaded caret. */
function mentionOpenSuggestions(): UseSuggestionsReturn {
	const mentions = {
		isOpen: true,
		suggestions: [{ name: "Doc", path: "Doc.md" }],
		selectedIndex: 0,
		context: { start: 2, end: 6, query: "doc" },
		updateSuggestions: async () => undefined,
		selectSuggestion: () => ({
			newText: NEW_TEXT,
			newCursorPos: END_OF_REFERENCE,
		}),
		navigate: () => undefined,
		close: () => undefined,
		dismiss: () => undefined,
		activeNote: null,
		isAutoMentionDisabled: true,
		toggleAutoMention: () => undefined,
		updateActiveNote: async () => undefined,
	};
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
		mentions,
		commands: closed,
		quickPrompts: closed,
		activePicker: null,
	} as unknown as UseSuggestionsReturn;
}

function baseProps(overrides: Partial<InputAreaProps>): InputAreaProps {
	return {
		isSending: false,
		isSessionReady: true,
		lazyState: "idle",
		isRestoringSession: false,
		agentLabel: "Claude Code",
		availableCommands: [],
		restoredMessage: null,
		suggestions: mentionOpenSuggestions(),
		plugin: makePlugin(),
		view: {} as IChatViewHost,
		onSendMessage: vi.fn(async () => undefined),
		onStopGeneration: vi.fn(async () => undefined),
		onRestoredMessageConsumed: () => undefined,
		supportsImages: false,
		imageCapabilityKnown: true,
		agentId: "claude-code-acp",
		inputValue: "a @doc b",
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

/** Controlled wrapper so the textarea value tracks onInputChange (caret can't
 * exceed the textarea's value length in jsdom). */
function Harness() {
	const [value, setValue] = React.useState("a @doc b");
	return (
		<InputArea
			{...baseProps({ inputValue: value, onInputChange: setValue })}
		/>
	);
}

describe("InputArea — mention selection caret (reported bug)", () => {
	it("places the caret at the end of the inserted reference, not end of text", async () => {
		vi.useFakeTimers();
		try {
			const { container } = render(<Harness />);

			const row = container.querySelector(
				".agent-client-mention-dropdown-item",
			) as HTMLElement;
			expect(row).not.toBeNull();

			// Click commits the new composer value (React flushes within act);
			// jsdom resets the caret to end-of-value on that assignment — exactly
			// what the browser does too.
			await act(async () => {
				fireEvent.click(row);
			});

			// The caret is applied in a setTimeout(0) that, per browser ordering,
			// runs AFTER the value commit. Flush it now and assert it wins.
			act(() => {
				vi.runAllTimers();
			});

			const textarea = container.querySelector(
				"textarea.agent-client-chat-input-textarea",
			) as HTMLTextAreaElement;
			expect(textarea.value).toBe(NEW_TEXT);
			expect(textarea.selectionStart).toBe(END_OF_REFERENCE);
			expect(textarea.selectionEnd).toBe(END_OF_REFERENCE);
		} finally {
			vi.useRealTimers();
		}
	});
});
