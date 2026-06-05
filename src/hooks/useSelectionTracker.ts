import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Narrow port interface for selection tracking.
 * Satisfied by VaultServiceAdapter without importing the full class.
 */
export interface SelectionSource {
	getActiveNote(): Promise<{
		path: string;
		name: string;
		selection?: { from: { line: number; ch: number }; to: { line: number; ch: number } };
	} | null>;
	subscribeSelectionChanges(listener: () => void): () => void;
}

export interface SelectionState {
	fromLine: number;
	toLine: number;
}

export interface UseSelectionTrackerReturn {
	/** Vault-relative path of the last active markdown note (persists across chat focus). */
	activeNotePath: string | null;
	/** Display name (basename without extension) of the last active markdown note. */
	activeNoteName: string | null;
	/** Current selection range in the last active markdown note, or null if none. */
	selection: SelectionState | null;
}

/**
 * Tracks the last-active markdown leaf's path and selection.
 *
 * Per Decision #24: only updates activeNotePath when a real MarkdownView
 * becomes active. When focus moves to the chat textarea (getActiveNote
 * returns null), the last known markdown note persists.
 */
export function useSelectionTracker(source: SelectionSource): UseSelectionTrackerReturn {
	const [activeNotePath, setActiveNotePath] = useState<string | null>(null);
	const [activeNoteName, setActiveNoteName] = useState<string | null>(null);
	const [selection, setSelection] = useState<SelectionState | null>(null);
	const sourceRef = useRef(source);
	sourceRef.current = source;

	const handleSelectionChange = useCallback(async () => {
		const note = await sourceRef.current.getActiveNote();
		if (note) {
			// A real markdown note is active — update everything
			setActiveNotePath(note.path);
			setActiveNoteName(note.name);
			if (note.selection) {
				setSelection({
					fromLine: note.selection.from.line,
					toLine: note.selection.to.line,
				});
			} else {
				setSelection(null);
			}
		}
		// If null, user focused non-markdown leaf (e.g., chat) — preserve last state (Decision #24)
	}, []);

	useEffect(() => {
		const unsubscribe = source.subscribeSelectionChanges(() => {
			void handleSelectionChange();
		});
		// Prime initial state on mount. The shared VaultService only emits to
		// the first subscriber (ensureSelectionTracking early-returns after),
		// so a new chat tab's tracker would otherwise stay null until the next
		// active-leaf-change — leaving the grab button disabled. (T02/T03)
		void handleSelectionChange();
		return unsubscribe;
	}, [source, handleSelectionChange]);

	return { activeNotePath, activeNoteName, selection };
}
