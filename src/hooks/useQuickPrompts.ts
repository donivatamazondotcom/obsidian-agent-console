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
import type { QuickPrompt } from "../types/quick-prompt";

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
	/** Show a transient notice. */
	notify(message: string): void;
}

export interface UseQuickPromptsReturn {
	/** Current parsed prompts (re-rendered on library reconcile). */
	prompts: QuickPrompt[];
	/** Fire / insert / queue a prompt per the engine and the live state. */
	runQuickPrompt: (prompt: QuickPrompt, opts: { modifier: boolean }) => void;
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
		(prompt: QuickPrompt, opts: { modifier: boolean }) => {
			const b = bridgeRef.current;
			executeQuickPrompt(
				prompt,
				{
					modifier: opts.modifier,
					composerHasText: b.getComposerText().trim().length > 0,
					isStreaming: b.isStreaming(),
					isQueued: b.isQueued(),
					selectionText: b.getSelectionText(),
				},
				{
					fireOrQueue: (text) => b.fireOrQueue(text),
					insert: (text) => b.insertAtCursor(text),
					notify: (message) => b.notify(message),
				},
			);
		},
		[],
	);

	return { prompts, runQuickPrompt };
}
