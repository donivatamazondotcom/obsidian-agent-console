import { App, Modal, SuggestModal } from "obsidian";

import type { PendingMcpAuth } from "../types/mcp-auth";
import type { McpAuthManager } from "../services/mcp-auth-manager";
import { modCombo, ENTER_KEY } from "../utils/platform";
import { t } from "../i18n";

/**
 * "Re-authenticate MCP servers" — lists servers waiting for sign-in.
 * Enter opens the sign-in page; mod+Enter copies the link.
 *
 * The keyboard twin of the sign-in Notice, and the recovery path after the
 * Notice was dismissed. See MCP OAuth Prompt Surfacing spec.
 */
export class McpAuthSuggestModal extends SuggestModal<PendingMcpAuth> {
	constructor(
		app: App,
		private manager: McpAuthManager,
	) {
		super(app);
		this.setPlaceholder(t("modals.mcpAuth.placeholder"));
		this.setInstructions([
			{ command: ENTER_KEY, purpose: t("modals.mcpAuth.instructionOpen") },
			{
				command: modCombo(ENTER_KEY),
				purpose: t("modals.mcpAuth.instructionCopy"),
			},
			{ command: "esc", purpose: t("modals.mcpAuth.instructionDismiss") },
		]);
	}

	getSuggestions(query: string): PendingMcpAuth[] {
		const lower = query.toLowerCase();
		return this.manager
			.getPending()
			.filter((p) => p.serverName.toLowerCase().includes(lower));
	}

	renderSuggestion(item: PendingMcpAuth, el: HTMLElement): void {
		el.createDiv({ text: t("modals.mcpAuth.needsSignIn", { server: item.serverName }) });
		const when = new Date(item.receivedAt).toLocaleTimeString([], {
			hour: "numeric",
			minute: "2-digit",
		});
		el.createDiv({
			cls: "agent-client-mcp-auth-suggestion-note",
			text: item.host
				? t("modals.mcpAuth.opensWaiting", { host: item.host, when })
				: t("modals.mcpAuth.waitingSince", { when }),
		});
	}

	onChooseSuggestion(
		item: PendingMcpAuth,
		evt: MouseEvent | KeyboardEvent,
	): void {
		const wantsCopy = evt.metaKey || evt.ctrlKey;
		if (wantsCopy) {
			void this.manager.copySignInLink(item);
		} else {
			this.manager.openSignIn(item);
		}
	}
}

/**
 * Shown by the re-authenticate command when nothing is waiting for sign-in.
 * Offers to restart the session, which makes the agent check every MCP
 * server again and request sign-in for any that need it (e.g. after a token
 * expired). Restart is confirm-gated: it interrupts anything in progress.
 */
export class McpAuthReconnectModal extends Modal {
	constructor(
		app: App,
		private onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(t("modals.mcpAuth.emptyTitle"));
		this.contentEl.createEl("p", {
			text: t("modals.mcpAuth.emptyBody"),
		});
		this.contentEl.createEl("p", {
			cls: "mod-warning",
			text: t("modals.mcpAuth.emptyWarning"),
		});

		const buttons = this.contentEl.createDiv({
			cls: "modal-button-container",
		});
		const confirm = buttons.createEl("button", {
			text: t("modals.mcpAuth.restartSession"),
		});
		confirm.addEventListener("click", () => {
			this.close();
			this.onConfirm();
		});
		const cancel = buttons.createEl("button", {
			cls: "mod-cta",
			text: t("modals.common.cancel"),
		});
		cancel.addEventListener("click", () => this.close());
		// Cancel is the safe default: restarting interrupts in-flight work,
		// so a stray Enter must not trigger it (smoke finding 2026-07-14).
		window.setTimeout(() => cancel.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
