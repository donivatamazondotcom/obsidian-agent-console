import { App, Modal, SuggestModal } from "obsidian";

import type { PendingMcpAuth } from "../types/mcp-auth";
import type { McpAuthManager } from "../services/mcp-auth-manager";
import { modCombo, ENTER_KEY } from "../utils/platform";

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
		this.setPlaceholder("Re-authenticate MCP servers\u2026");
		this.setInstructions([
			{ command: ENTER_KEY, purpose: "to open sign-in page" },
			{
				command: modCombo(ENTER_KEY),
				purpose: "to copy link",
			},
			{ command: "esc", purpose: "to dismiss" },
		]);
	}

	getSuggestions(query: string): PendingMcpAuth[] {
		const lower = query.toLowerCase();
		return this.manager
			.getPending()
			.filter((p) => p.serverName.toLowerCase().includes(lower));
	}

	renderSuggestion(item: PendingMcpAuth, el: HTMLElement): void {
		el.createDiv({ text: `${item.serverName} \u2013 needs sign-in` });
		const when = new Date(item.receivedAt).toLocaleTimeString([], {
			hour: "numeric",
			minute: "2-digit",
		});
		el.createDiv({
			cls: "agent-client-mcp-auth-suggestion-note",
			text: item.host
				? `Opens ${item.host} \u00B7 waiting since ${when}`
				: `Waiting since ${when}`,
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
		this.titleEl.setText("No sign-in requests waiting");
		this.contentEl.createEl("p", {
			text: "MCP servers only ask for sign-in while the agent is starting up. Restart the session to check again \u2013 if a server's sign-in has expired, a fresh prompt will appear.",
		});
		this.contentEl.createEl("p", {
			cls: "mod-warning",
			text: "Restarting interrupts anything the agent is currently doing in this tab.",
		});

		const buttons = this.contentEl.createDiv({
			cls: "modal-button-container",
		});
		const confirm = buttons.createEl("button", {
			text: "Restart session",
		});
		confirm.addEventListener("click", () => {
			this.close();
			this.onConfirm();
		});
		const cancel = buttons.createEl("button", {
			cls: "mod-cta",
			text: "Cancel",
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
