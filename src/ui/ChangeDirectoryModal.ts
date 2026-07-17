/**
 * Modal for selecting a working directory for a new chat session.
 *
 * Provides a text input for manual path entry and a Browse button
 * that opens the native OS folder picker via Electron's dialog API.
 * Calls onSelect callback with the chosen path when user clicks Start.
 */

import { Modal, App } from "obsidian";
import { pickFolder } from "../utils/folder-picker";
import { t } from "../i18n";

export class ChangeDirectoryModal extends Modal {
	private currentPath: string;
	private onSelect: (path: string) => void | Promise<void>;

	constructor(
		app: App,
		currentPath: string,
		onSelect: (path: string) => void | Promise<void>,
	) {
		super(app);
		this.currentPath = currentPath;
		this.onSelect = onSelect;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: t("modals.changeDirectory.title") });

		contentEl.createEl("p", {
			text: t("modals.changeDirectory.body"),
			cls: "agent-client-change-dir-description",
		});

		// Path input row (text input + browse button)
		const inputRow = contentEl.createDiv({
			cls: "agent-client-change-dir-input-row",
		});

		const inputEl = inputRow.createEl("input", {
			type: "text",
			cls: "agent-client-change-dir-input",
			placeholder: t("modals.changeDirectory.placeholder"),
		});
		inputEl.value = this.currentPath;

		const browseButton = inputRow.createEl("button", {
			text: t("modals.changeDirectory.browse"),
		});
		browseButton.addEventListener("click", () => {
			void this.openFolderPicker().then((selectedPath) => {
				if (selectedPath) {
					inputEl.value = selectedPath;
				}
			});
		});

		// Focus and select all text
		window.setTimeout(() => {
			inputEl.focus();
			inputEl.select();
		}, 10);

		// Enter key to start
		inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.selectAndClose(inputEl.value);
			}
		});

		// Buttons
		const buttonContainer = contentEl.createDiv({
			cls: "agent-client-change-dir-buttons",
		});

		buttonContainer
			.createEl("button", { text: t("modals.common.cancel") })
			.addEventListener("click", () => {
				this.close();
			});

		buttonContainer
			.createEl("button", {
				text: t("modals.changeDirectory.start"),
				cls: "mod-cta",
			})
			.addEventListener("click", () => {
				this.selectAndClose(inputEl.value);
			});
	}

	private async openFolderPicker(): Promise<string | null> {
		return pickFolder({
			title: t("settings.workingDirectory.pickerTitle"),
			defaultPath: this.currentPath,
		});
	}

	private selectAndClose(rawValue: string) {
		const value = rawValue.trim();
		if (!value) return;
		this.close();
		void this.onSelect(value);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
