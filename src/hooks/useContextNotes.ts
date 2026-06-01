import { useState, useCallback, useMemo } from "react";
import type { NoteMetadata, ContextNoteSource } from "../types/context";
import { MAX_CONTEXT_NOTES } from "../types/context";

export interface UseContextNotesReturn {
	notes: NoteMetadata[];
	isFull: boolean;
	add: (path: string, source: ContextNoteSource) => boolean;
	remove: (path: string) => void;
	has: (path: string) => boolean;
	rename: (oldPath: string, newPath: string) => void;
	clear: () => void;
}

/**
 * Per-chat context notes state. Manages the crystallized notes array
 * with cap enforcement, deduplication, and vault-event handling.
 */
export function useContextNotes(
	initial?: NoteMetadata[],
): UseContextNotesReturn {
	const [notes, setNotes] = useState<NoteMetadata[]>(() =>
		initial ? initial.slice(0, MAX_CONTEXT_NOTES) : [],
	);

	const isFull = notes.length >= MAX_CONTEXT_NOTES;

	const has = useCallback(
		(path: string) => notes.some((n) => n.path === path),
		[notes],
	);

	const add = useCallback(
		(path: string, source: ContextNoteSource): boolean => {
			let added = false;
			setNotes((prev) => {
				if (prev.length >= MAX_CONTEXT_NOTES) return prev;
				if (prev.some((n) => n.path === path)) return prev;
				added = true;
				return [...prev, { path, source, seen: false }];
			});
			return added;
		},
		[],
	);

	const remove = useCallback((path: string) => {
		setNotes((prev) => prev.filter((n) => n.path !== path));
	}, []);

	const rename = useCallback((oldPath: string, newPath: string) => {
		setNotes((prev) =>
			prev.map((n) => (n.path === oldPath ? { ...n, path: newPath } : n)),
		);
	}, []);

	const clear = useCallback(() => {
		setNotes([]);
	}, []);

	return useMemo(
		() => ({ notes, isFull, add, remove, has, rename, clear }),
		[notes, isFull, add, remove, has, rename, clear],
	);
}
