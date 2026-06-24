/**
 * `usePromptLibrary` — subscribe to the prompt-library service and surface the
 * prompts that apply to the currently active note.
 *
 * Combines two reactive inputs:
 *  - the parsed prompt list from `PromptLibraryService` (changes when the
 *    folder is edited or files change), via `useSyncExternalStore`;
 *  - the active note's tags (changes as the user navigates notes), supplied by
 *    the caller from the selection tracker.
 *
 * Matching is the pure `matchingPrompts` helper (OR tag-match; untagged
 * prompts are global). Returns a stable-by-content list for rendering.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { App } from "obsidian";
import { getAllTags, TFile } from "obsidian";
import type { PromptLibraryService } from "../services/prompt-library";
import type { PromptDefinition } from "../types/prompt";
import { matchingPrompts } from "../utils/prompt-matching";

/**
 * Read all tags for a note path (frontmatter + inline), via metadataCache.
 * Returns [] when the path is null or has no cache entry.
 */
export function readNoteTags(app: App, notePath: string | null): string[] {
	if (!notePath) return [];
	const file = app.vault.getAbstractFileByPath(notePath);
	if (!(file instanceof TFile)) return [];
	const cache = app.metadataCache.getFileCache(file);
	if (!cache) return [];
	return getAllTags(cache) ?? [];
}

export function usePromptLibrary(
	app: App,
	service: PromptLibraryService,
	activeNotePath: string | null,
): PromptDefinition[] {
	const subscribe = useCallback(
		(onChange: () => void) => service.subscribe(onChange),
		[service],
	);
	const prompts = useSyncExternalStore(subscribe, () => service.getPrompts());

	// Active-note tags. Recomputed when the path changes; the metadataCache read
	// is cheap and the active note changes rarely relative to renders.
	const noteTags = useMemo(
		() => readNoteTags(app, activeNotePath),
		[app, activeNotePath],
	);

	return useMemo(
		() => matchingPrompts(prompts, noteTags),
		[prompts, noteTags],
	);
}
