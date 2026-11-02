import { useState, useCallback, useMemo } from "react";
import type { ContextNote, ContextNoteSource } from "../types/context";
import { MAX_CONTEXT_NOTES } from "../types/context";
import { sanitizeContextNotes } from "../services/context-validator";

export interface UseContextNotesReturn {
	notes: ContextNote[];
	isFull: boolean;
	add: (path: string, source: ContextNoteSource) => boolean;
	remove: (path: string) => void;
	has: (path: string) => boolean;
	rename: (oldPath: string, newPath: string) => void;
	clear: () => void;
	replace: (notes: ContextNote[]) => void;
	/** Mark notes whose body reached the agent (call on send success, H6). */
	markHydrated: (paths: readonly string[]) => void;
}

/**
 * Per-chat context notes state. Manages the crystallized notes array
 * with cap enforcement, deduplication, and vault-event handling.
 */
export function useContextNotes(
	initial?: ContextNote[],
): UseContextNotesReturn {
	const [notes, setNotes] = useState<ContextNote[]>(() =>
		initial ? sanitizeContextNotes(initial).notes : [],
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
				return [...prev, { path, source, seen: false, hydrated: false }];
			});
			return added;
		},
		[],
	);

	const remove = useCallback((path: string) => {
		setNotes((prev) => prev.filter((n) => n.path !== path));
	}, []);

	const rename = useCallback((oldPath: string, newPath: string) => {
		setNotes((prev) => {
			if (!prev.some((n) => n.path === oldPath)) return prev;
			// Target already crystallized — drop the renamed entry to avoid a duplicate.
			if (prev.some((n) => n.path === newPath)) {
				return prev.filter((n) => n.path !== oldPath);
			}
			return prev.map((n) =>
				n.path === oldPath ? { ...n, path: newPath } : n,
			);
		});
	}, []);

	const clear = useCallback(() => {
		setNotes([]);
	}, []);

	const replace = useCallback((next: ContextNote[]) => {
		setNotes(sanitizeContextNotes(next).notes);
	}, []);

	const markHydrated = useCallback((paths: readonly string[]) => {
		if (paths.length === 0) return;
		const set = new Set(paths);
		setNotes((prev) => {
			if (!prev.some((n) => set.has(n.path) && n.hydrated !== true)) {
				return prev;
			}
			return prev.map((n) =>
				set.has(n.path) && n.hydrated !== true
					? { ...n, hydrated: true }
					: n,
			);
		});
	}, []);

	return useMemo(
		() => ({
			notes,
			isFull,
			add,
			remove,
			has,
			rename,
			clear,
			replace,
			markHydrated,
		}),
		[notes, isFull, add, remove, has, rename, clear, replace, markHydrated],
	);
}
