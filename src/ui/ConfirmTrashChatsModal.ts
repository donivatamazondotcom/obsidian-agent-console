import { App, Modal } from "obsidian";
import { t } from "../i18n";

/**
 * Confirm before moving chats or chat files to the trash (I202): lowering
 * Max saved chats, and the "Clean up unused chat files" command. States how
 * many and that they can be recovered from the trash.
 *
 * Same layout as ConfirmCloseModal (reuses its classes). Cancel is focused
 * so Enter and Escape both back out; `onCancel` also runs when the dialog is
 * dismissed any other way, so a caller can restore a dropdown.
 */
export class ConfirmTrashChatsModal extends Modal {
	private confirmed = false;

	constructor(
		app: App,
		private readonly text: { title: string; body: string },
		private readonly onConfirm: () => void,
		private readonly onCancel: () => void = () => {},
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.text.title });
		contentEl.createEl("p", {
			text: this.text.body,
			cls: "agent-client-confirm-close-message",
		});
		contentEl.createEl("p", {
			text: t("modals.confirmTrashChats.warning"),
			cls: "agent-client-confirm-close-warning",
		});
		const buttons = contentEl.createDiv({
			cls: "agent-client-confirm-close-buttons",
		});
		const cancel = buttons.createEl("button", {
			text: t("modals.common.cancel"),
		});
		cancel.addEventListener("click", () => this.close());
		const confirm = buttons.createEl("button", {
			text: t("modals.confirmTrashChats.confirm"),
			cls: "mod-warning",
		});
		confirm.addEventListener("click", () => {
			this.confirmed = true;
			this.close();
			this.onConfirm();
		});
		cancel.focus();
	}

	onClose() {
		this.contentEl.empty();
		if (!this.confirmed) this.onCancel();
	}
}
