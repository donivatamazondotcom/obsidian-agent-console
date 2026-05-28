/**
 * Modal for tab-state corruption recovery.
 *
 * Per [[ACP Tab Persistence Across Restarts]] § Corruption handling:
 * - Shows the raw saved state (read-only text block)
 * - "Retry restore" button re-attempts restoration
 * - "Discard saved state" button clears data.json tab state
 *
 * Covers T16/T17.
 */

import { Modal, App } from "obsidian";

export class CorruptionRecoveryModal extends Modal {
	private rawState: string;
	private onRetry: () => void;
	private onDiscard: () => Promise<void>;

	constructor(
		app: App,
		rawState: string,
		onRetry: () => void,
		onDiscard: () => Promise<void>,
	) {
		super(app);
		this.rawState = rawState;
		this.onRetry = onRetry;
		this.onDiscard = onDiscard;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("agent-client-corruption-modal");

		contentEl.createEl("h2", { text: "Tab state corruption" });

		contentEl.createEl("p", {
			text: "The saved tab state could not be restored. The raw data is shown below for manual inspection.",
		});

		// Raw state (read-only text block)
		const pre = contentEl.createEl("pre", {
			cls: "agent-client-corruption-raw",
		});
		pre.createEl("code", { text: this.rawState });

		// Buttons
		const buttonContainer = contentEl.createDiv({
			cls: "agent-client-corruption-buttons",
		});

		buttonContainer
			.createEl("button", { text: "Retry restore" })
			.addEventListener("click", () => {
				this.close();
				this.onRetry();
			});

		buttonContainer
			.createEl("button", {
				text: "Discard saved state",
				cls: "mod-warning",
			})
			.addEventListener("click", () => {
				this.close();
				void this.onDiscard();
			});

		buttonContainer
			.createEl("button", { text: "Close" })
			.addEventListener("click", () => {
				this.close();
			});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
