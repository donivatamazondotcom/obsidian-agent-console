import { App, Modal } from "obsidian";

/**
 * Confirmation modal shown before closing the Agent Console panel when it has
 * multiple open chats (tabs). Prevents losing several running agent sessions
 * to a single accidental Cmd+W.
 *
 * Mirrors the visual treatment of ConfirmDeleteModal (h2 title, muted warning
 * line, right-aligned buttons, destructive action styled `mod-warning`).
 *
 * See [[ACP Confirm Close With Multiple Tabs]].
 */
export class ConfirmCloseModal extends Modal {
	private tabCount: number;
	private onConfirm: () => void | Promise<void>;

	constructor(
		app: App,
		tabCount: number,
		onConfirm: () => void | Promise<void>,
	) {
		super(app);
		this.tabCount = tabCount;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Close Agent Console?" });

		contentEl.createEl("p", {
			text: `You have ${this.tabCount} open chats. Closing this panel will close all of them.`,
			cls: "agent-client-confirm-close-message",
		});

		contentEl.createEl("p", {
			text: "Closed chats can be reopened from session history.",
			cls: "agent-client-confirm-close-warning",
		});

		const buttonContainer = contentEl.createDiv({
			cls: "agent-client-confirm-close-buttons",
		});

		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
		});
		cancelButton.addEventListener("click", () => {
			this.close();
		});

		const closeButton = buttonContainer.createEl("button", {
			text: "Close panel",
			cls: "mod-warning",
		});
		closeButton.addEventListener("click", () => {
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
