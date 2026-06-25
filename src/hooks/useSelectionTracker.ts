import { useState, useEffect, useCallback, useRef } from "react";

/** Basename without the final extension (matches Obsidian's TFile.basename). (I85) */
function basename(path: string): string {
	const base = path.split("/").pop() ?? path;
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(0, dot) : base;
}

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
	/** Subscribe to vault rename/move events. Returns an unsubscribe fn. (I85) */
	onRename(cb: (oldPath: string, newPath: string) => void): () => void;
	/** Subscribe to vault delete events. Returns an unsubscribe fn. (I100) */
	onDelete(cb: (path: string) => void): () => void;
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
	// Keep the latest path readable inside the rename callback without
	// re-subscribing on every path change. (I85)
	const activeNotePathRef = useRef(activeNotePath);
	activeNotePathRef.current = activeNotePath;

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
		// I85: a vault rename/move of the currently-tracked active note does not
		// fire active-leaf-change, so refresh path+name from the rename event
		// directly. Mirrors contextNotes.rename for crystallized pills.
		const unsubscribeRename = source.onRename((oldPath, newPath) => {
			if (activeNotePathRef.current === oldPath) {
				setActiveNotePath(newPath);
				setActiveNoteName(basename(newPath));
			}
		});
		// I100: deleting the currently-tracked active note must clear the
		// tracker. Decision #24 preserves the last path when getActiveNote()
		// returns null (correct for chat focus) — but a deleted file is gone,
		// not merely unfocused, so without this the stale path would drive the
		// provisional auto-default pill and ride into the sent context ref.
		const unsubscribeDelete = source.onDelete((deletedPath) => {
			if (activeNotePathRef.current === deletedPath) {
				setActiveNotePath(null);
				setActiveNoteName(null);
				setSelection(null);
			}
		});
		// Prime initial state on mount. The shared VaultService only emits to
		// the first subscriber (ensureSelectionTracking early-returns after),
		// so a new chat tab's tracker would otherwise stay null until the next
		// active-leaf-change — leaving the grab button disabled. (T02/T03)
		void handleSelectionChange();
		return () => {
			unsubscribe();
			unsubscribeRename();
			unsubscribeDelete();
		};
	}, [source, handleSelectionChange]);

	return { activeNotePath, activeNoteName, selection };
}
