import { AbstractInputSuggest, App, Modal, TFolder } from "obsidian";
import { filterFolderSuggestions } from "../services/quick-prompts-logic";

/**
 * Vault-folder autocomplete for the folder-choice input. Built on Obsidian's
 * sanctioned `AbstractInputSuggest` (the idiomatic suggester for a text input),
 * with the filtering delegated to the pure `filterFolderSuggestions` so the
 * match logic is unit-tested without an Obsidian harness.
 */
class FolderInputSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private readonly inputEl: HTMLInputElement,
	) {
		super(app, inputEl);
	}

	private allFolders(): string[] {
		return this.app.vault
			.getAllLoadedFiles()
			.filter((file): file is TFolder => file instanceof TFolder)
			.map((folder) => folder.path)
			.filter((path) => path.length > 0);
	}

	protected getSuggestions(query: string): string[] {
		return filterFolderSuggestions(this.allFolders(), query);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string): void {
		this.setValue(value);
		this.close();
	}
}

/**
 * First-creation folder prompt (Slice 6). Shown once — on the user's first
 * quick-prompt creation when no prompts exist yet AND the folder is still the
 * default — to ask where prompts should live, so the plugin never silently
 * creates a root `Quick Prompts/` folder in an organized vault.
 *
 * Resolves the chosen folder, or **null on Cancel** (Escape / click-out / X /
 * the Cancel button) — the caller treats null as "abort the whole creation"
 * (No-silent-data-loss). The gate self-latches, so a power user who already set
 * a custom folder never sees this, and it never reappears after the first note.
 *
 * See [[Agent Console Quick Prompts UX Refinement]] § Slice 6.
 */
export class ChooseQuickPromptFolderModal extends Modal {
	private inputEl!: HTMLInputElement;
	private resolved = false;

	constructor(
		app: App,
		private readonly defaultFolder: string,
		private readonly onResult: (folder: string | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass("agent-client-qp-folder-modal");
		this.titleEl.setText("Where should quick prompts live?");

		contentEl.createEl("p", {
			text: "Pick a folder for your quick prompt notes. They are saved here so you can find and edit them later — you can change this any time in settings.",
			cls: "agent-client-qp-folder-desc",
		});

		this.inputEl = contentEl.createEl("input", {
			type: "text",
			cls: "agent-client-qp-folder-input",
			placeholder: this.defaultFolder,
		});
		this.inputEl.value = this.defaultFolder;
		new FolderInputSuggest(this.app, this.inputEl);

		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.submit();
			}
		});

		const buttons = contentEl.createDiv({ cls: "modal-button-container" });
		const cancel = buttons.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => {
			this.finish(null);
		});
		const confirm = buttons.createEl("button", {
			text: "Use this folder",
			cls: "mod-cta",
		});
		confirm.addEventListener("click", () => {
			this.submit();
		});

		// Focus + select so the user can overtype the prefilled default.
		window.setTimeout(() => {
			this.inputEl.focus();
			this.inputEl.select();
		}, 0);
	}

	private submit(): void {
		this.finish(this.inputEl.value);
	}

	/**
	 * Resolve exactly once. `close()` triggers `onClose`, which calls this with
	 * null; the `resolved` guard makes that a no-op after an explicit choice.
	 */
	private finish(folder: string | null): void {
		if (this.resolved) return;
		this.resolved = true;
		this.close();
		this.onResult(folder);
	}

	onClose(): void {
		// Closing without an explicit choice (Escape / click-out / X) = Cancel.
		this.finish(null);
		this.contentEl.empty();
	}
}
