/**
 * useQuickPrompts — exposes the live quick-prompt list plus a single
 * `runQuickPrompt` action that fires / inserts / queues per the engine, using
 * the live composer, queue, and selection state supplied by the bridge.
 *
 * All the decision/resolution logic is pure (`quick-prompts-logic`); this hook
 * is the thin React seam that subscribes to the library and wires the bridge's
 * getters/effects into `executeQuickPrompt`.
 *
 * See [[Agent Console Quick Prompts and Workflows]] § Architecture.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { QuickPromptLibrary } from "../services/quick-prompts";
import { executeQuickPrompt } from "../services/quick-prompts-logic";
import { resolvePromptTarget } from "../resolvers/prompt-target";
import type { NamedItem, SessionModes } from "../resolvers/session-modes";
import type { QuickPromptGesture } from "../services/quick-prompts-logic";
import type {
	NewTabPromptOpts,
	PromptNoteSource,
	QuickPrompt,
} from "../types/quick-prompt";

/**
 * Live composer/queue/selection state + effects for the current tab. ChatPanel
 * implements this against its own refs and send path; the picker command and
 * the chips (slice 2) both drive `runQuickPrompt` through it.
 */
export interface QuickPromptComposerBridge {
	/** Current unsent composer text (trimmed-empty ⇒ no draft). */
	getComposerText(): string;
	/** Current editor selection text at fire time, or null when none. */
	getSelectionText(): string | null;
	/** A turn is streaming (queue slot empty). */
	isStreaming(): boolean;
	/** A message is already queued (slot full → composer locked). */
	isQueued(): boolean;
	/** Fire/queue: replace the (empty) composer and dispatch via the send path. */
	fireOrQueue(text: string): void;
	/** Insert at the cursor, preserving any existing draft. */
	insertAtCursor(text: string): void;
	/**
	 * Open a fresh tab/session and either send `text` there (`send: true`) or
	 * only seed its composer for editing (`send: false`). For `newTab` prompts;
	 * never touches the current tab's composer. Implemented by ChatPanel via a
	 * ChatView-supplied callback that owns the tab manager.
	 */
	openInNewTab(text: string, opts: NewTabPromptOpts): void;
	/** Show a transient notice. */
	notify(message: string): void;
	/** Agent id of this tab, or null when it has none yet. */
	getActiveAgentId(): string | null;
	/** This tab's session modes, or null when unknown / none. */
	getActiveModes(): SessionModes | null;
	/** Configured agents (settings id + display name). */
	getAgents(): readonly NamedItem[];
	/** Active note's `source-url` + title for `{{url}}` / `{{title}}`. */
	getNoteSource?(): PromptNoteSource | undefined;
}

export interface UseQuickPromptsReturn {
	/** Current parsed prompts (re-rendered on library reconcile). */
	prompts: QuickPrompt[];
	/** Fire / insert / queue / new-tab a prompt per the engine + live state. */
	runQuickPrompt: (prompt: QuickPrompt, gesture: QuickPromptGesture) => void;
}

export function useQuickPrompts(
	library: QuickPromptLibrary,
	bridge: QuickPromptComposerBridge,
): UseQuickPromptsReturn {
	const [prompts, setPrompts] = useState<QuickPrompt[]>(() =>
		library.getPrompts(),
	);

	useEffect(() => {
		// Sync immediately (library may have reconciled before subscribe) and
		// on every later reconcile.
		setPrompts(library.getPrompts());
		return library.subscribe(() => setPrompts(library.getPrompts()));
	}, [library]);

	// Keep the bridge readable from the stable callback without re-creating it.
	const bridgeRef = useRef(bridge);
	bridgeRef.current = bridge;

	const runQuickPrompt = useCallback(
		(prompt: QuickPrompt, gesture: QuickPromptGesture) => {
			const b = bridgeRef.current;
			// One resolver decides where every fire lands ([[Agent Console
			// Quick Prompt Agent and Mode]]): a different agent or mode → a
			// new tab set up that way; otherwise in place.
			const target = resolvePromptTarget(
				{ agent: prompt.agent, mode: prompt.mode, newTab: prompt.newTab },
				{
					activeAgentId: b.getActiveAgentId(),
					activeModes: b.getActiveModes(),
					agents: b.getAgents(),
				},
			);
			executeQuickPrompt(
				prompt,
				{
					openElsewhere: gesture.openElsewhere,
					foreground: gesture.foreground,
					insert: gesture.insert,
					composerHasText: b.getComposerText().trim().length > 0,
					isStreaming: b.isStreaming(),
					isQueued: b.isQueued(),
					selectionText: b.getSelectionText(),
					noteSource: b.getNoteSource?.(),
					target,
				},
				{
					fireOrQueue: (text) => b.fireOrQueue(text),
					insert: (text) => b.insertAtCursor(text),
					openInNewTab: (text, opts) => b.openInNewTab(text, opts),
					notify: (message) => b.notify(message),
				},
			);
		},
		[],
	);

	return { prompts, runQuickPrompt };
}
