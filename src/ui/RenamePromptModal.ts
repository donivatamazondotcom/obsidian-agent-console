import { App, Modal } from "obsidian";

/**
 * Rename a quick prompt's display label (slice 5 chip context menu → Rename).
 *
 * Relabels the PILL only: the caller writes the note's `label:` frontmatter, so
 * the filename — and the prompt's filename-derived `id` — stay put (Obsidian
 * owns file renames). Prefilled with the current label; Enter or the Rename
 * button submits the raw input. Whether the submission is a real change (vs an
 * empty / unchanged no-op) is decided by the caller via `normalizeRenameLabel`.
 *
 * Layout (QP-I24): title, a full-width text input, then a standard
 * `modal-button-container` button row — no right-aligned `Setting` rows, which
 * left large empty gutters.
 *
 * See [[Agent Console Quick Prompts UX Refinement]] § Slice 5 — Chip context menu.
 */
export class RenamePromptModal extends Modal {
	private inputEl!: HTMLInputElement;

	constructor(
		app: App,
		private currentLabel: string,
		private onSubmit: (raw: string) => void | Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.titleEl.setText("Rename quick prompt");

		this.inputEl = contentEl.createEl("input", {
			type: "text",
			cls: "agent-client-rename-prompt-input",
		});
		this.inputEl.value = this.currentLabel;
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.submit();
			}
		});

		const buttons = contentEl.createDiv({ cls: "modal-button-container" });
		const rename = buttons.createEl("button", {
			text: "Rename",
			cls: "mod-cta",
		});
		rename.addEventListener("click", () => {
			this.submit();
		});

		// Focus + select so the user can overtype immediately.
		window.setTimeout(() => {
			this.inputEl.focus();
			this.inputEl.select();
		}, 0);
	}

	private submit(): void {
		const raw = this.inputEl.value;
		this.close();
		void this.onSubmit(raw);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
