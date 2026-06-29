import { App, Modal } from "obsidian";

/**
 * Confirmation modal shown before resetting the Obsidian system prompt to
 * defaults when the user has typed their own content (vault context or a
 * hand-edited full prompt). Prevents losing that text to a single accidental
 * click on "Reset to defaults".
 *
 * Mirrors the visual treatment of ConfirmCloseModal / ConfirmDeleteModal (h2
 * title, muted explanatory line, right-aligned buttons, destructive action
 * styled `mod-warning`). Cancel is focused as the safe default so Enter and
 * Escape both back out.
 *
 * Spec: [[Obsidian System Prompt]].
 */
export class ConfirmResetModal extends Modal {
	private onConfirm: () => void | Promise<void>;

	constructor(app: App, onConfirm: () => void | Promise<void>) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Reset Obsidian system prompt?" });

		contentEl.createEl("p", {
			text: "This turns all switches back on and clears your vault context and any prompt you've edited by hand.",
			cls: "agent-client-confirm-reset-message",
		});

		contentEl.createEl("p", {
			text: "This can't be undone.",
			cls: "agent-client-confirm-reset-warning",
		});

		const buttonContainer = contentEl.createDiv({
			cls: "agent-client-confirm-reset-buttons",
		});

		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
		});
		cancelButton.addEventListener("click", () => {
			this.close();
		});

		const resetButton = buttonContainer.createEl("button", {
			text: "Reset to defaults",
			cls: "mod-warning",
		});
		resetButton.addEventListener("click", () => {
			this.close();
			void this.onConfirm();
		});

		// Cancel is the safe default — focus it so Enter/Escape both back out.
		cancelButton.focus();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
