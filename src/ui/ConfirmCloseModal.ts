import { App, Modal } from "obsidian";
import { t } from "../i18n";

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

		contentEl.createEl("h2", { text: t("modals.confirmClose.title") });

		contentEl.createEl("p", {
			text: t("modals.confirmClose.body", { count: this.tabCount }),
			cls: "agent-client-confirm-close-message",
		});

		contentEl.createEl("p", {
			text: t("modals.confirmClose.hint"),
			cls: "agent-client-confirm-close-warning",
		});

		const buttonContainer = contentEl.createDiv({
			cls: "agent-client-confirm-close-buttons",
		});

		const cancelButton = buttonContainer.createEl("button", {
			text: t("modals.common.cancel"),
		});
		cancelButton.addEventListener("click", () => {
			this.close();
		});

		const closeButton = buttonContainer.createEl("button", {
			text: t("modals.confirmClose.confirm"),
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
