/**
 * quick-prompts — the Quick Prompts library service.
 *
 * `QuickPromptLibrary` keeps an in-memory list of parsed prompts, refreshed on
 * folder changes so adding/editing/removing a `.md` file makes the prompt
 * appear/update/disappear with no plugin restart. It is decoupled from
 * Obsidian via the `QuickPromptSource` port, so the scan/watch/reconcile logic
 * is unit-testable without an Obsidian harness (T05). `VaultQuickPromptSource`
 * is the real adapter over the Vault API + metadata cache.
 *
 * Pure parse/label/id/folder logic lives in `quick-prompts-logic`.
 * See [[Agent Console Quick Prompts and Workflows]] § Storage / § Architecture.
 */

import { TFile, normalizePath, type EventRef } from "obsidian";
import type AgentClientPlugin from "../plugin";
import {
	buildNewPromptNote,
	buildQuickPrompt,
	deriveFilenameBase,
	disambiguateFilename,
	isQuickPromptFile,
	normalizeRenameLabel,
	stripFrontmatter,
} from "./quick-prompts-logic";
import type { QuickPrompt, QuickPromptFileInput } from "../types/quick-prompt";
import { getLogger } from "../utils/logger";

/**
 * Source of quick-prompt files. The adapter is responsible for folder scoping,
 * reading frontmatter + body, and emitting a change signal when anything in
 * the folder changes.
 */
export interface QuickPromptSource {
	/** Load all (folder-scoped) candidate prompt files with frontmatter + body. */
	load(): Promise<QuickPromptFileInput[]>;
	/** Subscribe to folder changes. Returns an unsubscribe fn. */
	onChange(cb: () => void): () => void;
}

/**
 * In-memory quick-prompt library with live reconcile-on-watch.
 */
export class QuickPromptLibrary {
	private prompts: QuickPrompt[] = [];
	private listeners = new Set<() => void>();
	private unsubscribeSource: (() => void) | null = null;
	/** Guards against an older slow refresh clobbering a newer one. */
	private refreshSeq = 0;

	constructor(private source: QuickPromptSource) {}

	/** Initial scan + start watching. Idempotent re-entrancy is guarded by seq. */
	async init(): Promise<void> {
		// Subscribe BEFORE the initial scan so a metadataCache "changed" event
		// that fires while the first scan is in flight is not dropped (QP-I26).
		// On a cold start a prompt's frontmatter may not be cached yet, so the
		// initial scan falls back to the filename label (and loses
		// `open in new tab`); the "changed" event that lands when the cache
		// resolves is what reconciles it. If we subscribed only after the scan,
		// an event in that window would be lost and the fallback entry would
		// stick until a manual rescan. The refreshSeq guard makes the reconcile
		// scan win over the stale initial scan regardless of resolution order.
		this.unsubscribeSource = this.source.onChange(() => {
			void this.refresh();
		});
		await this.refresh();
	}

	private async refresh(): Promise<void> {
		const seq = ++this.refreshSeq;
		let files: QuickPromptFileInput[];
		try {
			files = await this.source.load();
		} catch (error) {
			getLogger().error("[QuickPrompts] load failed", error);
			return;
		}
		// A newer refresh started while we awaited — discard this stale result.
		if (seq !== this.refreshSeq) return;
		this.prompts = files.map(buildQuickPrompt);
		this.notify();
	}

	/** Current parsed prompts (snapshot). */
	getPrompts(): QuickPrompt[] {
		return this.prompts;
	}

	/** Force a re-scan (e.g. after the configured folder changes in settings). */
	async rescan(): Promise<void> {
		await this.refresh();
	}

	/** Subscribe to library changes (re-scans). Returns an unsubscribe fn. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private notify(): void {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch (error) {
				getLogger().error("[QuickPrompts] listener error", error);
			}
		}
	}

	destroy(): void {
		this.unsubscribeSource?.();
		this.unsubscribeSource = null;
		this.listeners.clear();
	}
}

/**
 * Real adapter: scans the configured folder via the Vault API, reads
 * frontmatter from the metadata cache and the body via `cachedRead`, and
 * emits a change on any create/modify/delete/rename within the folder (plus
 * metadata-cache changes so frontmatter edits reconcile promptly).
 *
 * `folder` is read lazily so a settings change to the folder takes effect on
 * the next scan without re-instantiating the source.
 */
export class VaultQuickPromptSource implements QuickPromptSource {
	constructor(
		private plugin: AgentClientPlugin,
		private folder: () => string,
	) {}

	async load(): Promise<QuickPromptFileInput[]> {
		const folder = this.folder();
		const files = this.plugin.app.vault
			.getMarkdownFiles()
			.filter((file) => isQuickPromptFile(file.path, folder));
		const out: QuickPromptFileInput[] = [];
		for (const file of files) {
			const frontmatter =
				this.plugin.app.metadataCache.getFileCache(file)?.frontmatter ??
				null;
			let raw = "";
			try {
				raw = await this.plugin.app.vault.cachedRead(file);
			} catch (error) {
				getLogger().warn(
					`[QuickPrompts] failed to read ${file.path}`,
					error,
				);
				continue;
			}
			out.push({
				path: file.path,
				basename: file.basename,
				frontmatter,
				body: stripFrontmatter(raw),
			});
		}
		return out;
	}

	onChange(cb: () => void): () => void {
		const inFolder = (path: string) => isQuickPromptFile(path, this.folder());
		const refs: EventRef[] = [];
		const vault = this.plugin.app.vault;

		const fileHandler = (file: unknown) => {
			if (file instanceof TFile && inFolder(file.path)) cb();
		};
		refs.push(vault.on("create", fileHandler));
		refs.push(vault.on("modify", fileHandler));
		refs.push(vault.on("delete", fileHandler));
		refs.push(
			vault.on("rename", (file, oldPath) => {
				if (
					file instanceof TFile &&
					(inFolder(file.path) || inFolder(oldPath))
				) {
					cb();
				}
			}),
		);
		// Frontmatter edits land in the metadata cache; reconcile so label/tags
		// stay current even when the body did not change.
		const metaRef = this.plugin.app.metadataCache.on("changed", (file) => {
			if (file instanceof TFile && inFolder(file.path)) cb();
		});

		return () => {
			for (const ref of refs) vault.offref(ref);
			this.plugin.app.metadataCache.offref(metaRef);
		};
	}
}

/**
 * Writer port for creating quick-prompt notes. Decoupled from Obsidian so the
 * clobber-safe orchestration is unit-testable without a vault harness.
 * `VaultQuickPromptWriter` is the real adapter.
 */
export interface QuickPromptWriter {
	/** Existing basenames in the prompts folder (for collision disambiguation). */
	listBasenames(): string[];
	/**
	 * Create `folder/<basename>.md` with `body`, then set the typed frontmatter.
	 * MUST NOT overwrite an existing file (throws on a true collision). Returns
	 * the created vault path.
	 */
	create(
		basename: string,
		body: string,
		frontmatter: Record<string, unknown>,
	): Promise<string>;
	/**
	 * Set the display label (`label:` frontmatter) of an existing prompt
	 * note (slice 5 chip context menu → Rename). MUST NOT touch the filename
	 * (Obsidian owns file renames) — only the `label` field.
	 */
	setLabel(path: string, label: string): Promise<void>;
}

/**
 * Create a quick-prompt note, clobber-safe (No-silent-data-loss). Derives a
 * filesystem-safe basename from the label, disambiguates against existing notes
 * (never overwrites), builds the templated note, and writes via the port.
 * Returns the created path + basename.
 *
 * - (a) create-on-no-match passes only a `label` (placeholder body);
 * - (b) save-composer passes `label` + the captured `body`.
 */
export async function createQuickPrompt(
	writer: QuickPromptWriter,
	opts: { label: string; body?: string },
): Promise<{ path: string; basename: string; collided: boolean }> {
	const desired = deriveFilenameBase(opts.label);
	const basename = disambiguateFilename(desired, writer.listBasenames());
	const note = buildNewPromptNote(opts);
	const path = await writer.create(basename, note.body, note.frontmatter);
	// `collided` ⟺ the desired name was taken and we disambiguated (QP-I03/#3),
	// so the caller can explain the rename instead of a silent " 1" suffix.
	return { path, basename, collided: basename !== desired };
}

/**
 * Rename a quick prompt's display label (slice 5 chip context menu → Rename).
 * `normalizeRenameLabel` (pure) decides whether the submission is a real change;
 * on a change, writes ONLY the `label:` frontmatter through the writer port
 * (filename + id untouched — Obsidian owns file renames). A no-op
 * (empty / whitespace / unchanged) never touches the note (No-silent-data-loss).
 */
export async function renamePromptLabel(
	writer: QuickPromptWriter,
	prompt: Pick<QuickPrompt, "path" | "label">,
	raw: string,
): Promise<{ changed: boolean; label: string | null }> {
	const next = normalizeRenameLabel(raw, prompt.label);
	if (next == null) return { changed: false, label: null };
	await writer.setLabel(prompt.path, next);
	return { changed: true, label: next };
}

/**
 * Real writer adapter: creates the note via the Vault API and sets typed
 * frontmatter via the sanctioned `FileManager.processFrontMatter`
 * (https://docs.obsidian.md/Reference/TypeScript+API/FileManager/processFrontMatter).
 * `existing` supplies the current prompt basenames for disambiguation;
 * `Vault.create` additionally throws on a true path collision (belt-and-
 * suspenders against overwrite).
 */
export class VaultQuickPromptWriter implements QuickPromptWriter {
	constructor(
		private plugin: AgentClientPlugin,
		private folder: () => string,
		private existing: () => string[],
	) {}

	listBasenames(): string[] {
		return this.existing();
	}

	async create(
		basename: string,
		body: string,
		frontmatter: Record<string, unknown>,
	): Promise<string> {
		const folder = this.folder().replace(/\/+$/, "");
		await this.ensureFolder(folder);
		const path = normalizePath(
			folder.length > 0 ? `${folder}/${basename}.md` : `${basename}.md`,
		);
		const file = await this.plugin.app.vault.create(path, body);
		await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
			Object.assign(fm, frontmatter);
		});
		return file.path;
	}

	async setLabel(path: string, label: string): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			getLogger().warn(
				`[QuickPrompts] setLabel: not a prompt file: ${path}`,
			);
			return;
		}
		await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
			Object.assign(fm, { label });
		});
	}

	private async ensureFolder(folder: string): Promise<void> {
		if (folder.length === 0) return;
		if (!this.plugin.app.vault.getAbstractFileByPath(folder)) {
			try {
				await this.plugin.app.vault.createFolder(folder);
			} catch {
				// Folder created concurrently (race) — safe to ignore.
			}
		}
	}
}
