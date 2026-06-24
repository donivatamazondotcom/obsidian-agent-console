/**
 * Prompt-library service.
 *
 * Scans the user-designated prompt folder (`promptLibraryFolder` setting),
 * parses each markdown file into a `PromptDefinition`, and caches the result.
 * Refreshes when files in the folder change (create/modify/delete/rename) and
 * when the folder setting changes. Exposes a subscribe() so React can re-render
 * the in-panel button row on changes.
 *
 * Files that fail to parse are omitted (and logged in debug mode) rather than
 * throwing — one malformed prompt never breaks the rest of the library.
 */

import { TFile, TFolder, parseYaml, type App } from "obsidian";
import type { PromptDefinition } from "../types/prompt";
import { parsePromptFile } from "./prompt-parser";
import { getLogger } from "../utils/logger";

/** Minimal settings surface the service needs (folder + agent ids). */
export interface PromptLibraryDeps {
	app: App;
	/** Returns the current prompt-library folder (vault-relative), or "" if unset. */
	getFolder: () => string;
	/** Returns the configured agent ids (for validating each prompt's `agent`). */
	getKnownAgentIds: () => string[];
}

export class PromptLibraryService {
	private prompts: PromptDefinition[] = [];
	private listeners = new Set<() => void>();
	private eventRefs: Array<ReturnType<App["vault"]["on"]>> = [];
	private loaded = false;

	constructor(private deps: PromptLibraryDeps) {}

	/**
	 * Begin watching the vault for prompt-folder changes and do an initial scan.
	 * Idempotent — safe to call once on plugin load.
	 */
	start(): void {
		const { app } = this.deps;
		const onVaultChange = (file: { path: string }) => {
			if (this.isInFolder(file.path)) void this.refresh();
		};
		this.eventRefs.push(
			app.vault.on("create", onVaultChange),
			app.vault.on("modify", onVaultChange),
			app.vault.on("delete", onVaultChange),
			// Rename fires with the new file + old path; refresh if either side
			// touches the folder (moved in or out).
			app.vault.on("rename", (file, oldPath) => {
				if (this.isInFolder(file.path) || this.isInFolder(oldPath)) {
					void this.refresh();
				}
			}),
		);
		void this.refresh();
	}

	/** Stop watching and release listeners. Call on plugin unload. */
	stop(): void {
		for (const ref of this.eventRefs) this.deps.app.vault.offref(ref);
		this.eventRefs = [];
		this.listeners.clear();
	}

	/** Current parsed prompts (cached). Empty until the first scan resolves. */
	getPrompts(): PromptDefinition[] {
		return this.prompts;
	}

	/** True once at least one scan has completed (for empty-vs-loading UI). */
	isLoaded(): boolean {
		return this.loaded;
	}

	/** Subscribe to library changes; returns an unsubscribe fn. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Re-scan the folder. Called by start(), vault events, and setting changes. */
	async refresh(): Promise<void> {
		const folder = this.deps.getFolder().trim();
		if (folder === "") {
			this.setPrompts([]);
			this.loaded = true;
			this.emit();
			return;
		}

		const files = this.collectMarkdownFiles(folder);
		const knownAgentIds = this.deps.getKnownAgentIds();
		const next: PromptDefinition[] = [];

		for (const file of files) {
			try {
				const content = await this.deps.app.vault.cachedRead(file);
				const result = parsePromptFile(
					file.path,
					content,
					parseYaml,
					knownAgentIds,
				);
				if (result.ok) {
					next.push(result.prompt);
				} else {
					getLogger().log(
						"[PromptLibrary] Skipped invalid prompt:",
						result.errors.join("; "),
					);
				}
			} catch (error) {
				getLogger().warn(
					`[PromptLibrary] Failed to read ${file.path}:`,
					error,
				);
			}
		}

		// Stable display order: by description (case-insensitive), then path.
		next.sort(
			(a, b) =>
				a.description.localeCompare(b.description, undefined, {
					sensitivity: "base",
				}) || a.path.localeCompare(b.path),
		);

		this.setPrompts(next);
		this.loaded = true;
		this.emit();
	}

	/** Is a vault path inside the configured folder (or a subfolder)? */
	private isInFolder(path: string): boolean {
		const folder = this.deps.getFolder().trim();
		if (folder === "") return false;
		const prefix = folder.endsWith("/") ? folder : folder + "/";
		return path === folder || path.startsWith(prefix);
	}

	/** Recursively collect markdown files under the folder. */
	private collectMarkdownFiles(folder: string): TFile[] {
		const root = this.deps.app.vault.getAbstractFileByPath(folder);
		if (!(root instanceof TFolder)) return [];
		const out: TFile[] = [];
		const walk = (f: TFolder) => {
			for (const child of f.children) {
				if (child instanceof TFolder) walk(child);
				else if (child instanceof TFile && child.extension === "md") {
					out.push(child);
				}
			}
		};
		walk(root);
		return out;
	}

	private setPrompts(prompts: PromptDefinition[]): void {
		this.prompts = prompts;
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}
}
