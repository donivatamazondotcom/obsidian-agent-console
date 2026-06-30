import { App, Modal, Setting } from "obsidian";

/**
 * Rename a quick prompt's display label (slice 5 chip context menu → Rename).
 *
 * Relabels the PILL only: the caller writes the note's `label:` frontmatter, so
 * the filename — and the prompt's filename-derived `id` — stay put (Obsidian
 * owns file renames). Prefilled with the current label; Enter or the Rename
 * button submits the raw input. Whether the submission is a real change (vs an
 * empty / unchanged no-op) is decided by the caller via `normalizeRenameLabel`.
 *
 * See [[Agent Console Quick Prompts UX Refinement]] § Slice 5 — Chip context menu.
 */
export class RenamePromptModal extends Modal {
	private value: string;

	constructor(
		app: App,
		private currentLabel: string,
		private onSubmit: (raw: string) => void | Promise<void>,
	) {
		super(app);
		this.value = currentLabel;
	}

	onOpen(): void {
		const { contentEl } = this;
		this.titleEl.setText("Rename quick prompt");

		new Setting(contentEl).setName("New name").addText((text) => {
			text.setValue(this.currentLabel);
			text.onChange((v) => {
				this.value = v;
			});
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					this.submit();
				}
			});
			// Focus + select so the user can overtype immediately.
			window.setTimeout(() => {
				text.inputEl.focus();
				text.inputEl.select();
			}, 0);
		});

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Rename")
				.setCta()
				.onClick(() => {
					this.submit();
				}),
		);
	}

	private submit(): void {
		const raw = this.value;
		this.close();
		void this.onSubmit(raw);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
