import { App, Modal } from "obsidian";

import type {
	SessionIntentConfirmRequest,
	SessionIntentDecision,
} from "./session-intent-confirm";

/**
 * Confirm modal for destructive session transitions.
 *
 * Shared between Track 2 surfaces (switch-agent, new-chat, hard-reload).
 * Track 1 consumes via the SessionIntentConfirmModal interface.
 *
 * Copy is plain language per [[Agent-Portable Sessions]] spec:
 * - No jargon ("session", "harness", "subprocess")
 * - No internal terms ("recreate-lazy", "respawn-lazy")
 * - Mentions that the conversation stays saved in History (recoverability)
 *
 * See [[Local-First Session Model]] § Cross-cutting guard audit.
 */

interface ModalCopy {
	title: string;
	body: string;
	confirmLabel: string;
	confirmCls?: string;
}

function getCopy(request: SessionIntentConfirmRequest, agentName?: string): ModalCopy {
	const agent = agentName || "the new agent";

	switch (request.kind) {
		case "switch-agent":
			return {
				title: `Switch to ${agent}?`,
				body: `Switching to ${agent} starts a fresh chat. We'll give ${agent} the earlier messages so it has the context\u2009—\u2009but it won't have the first agent's tools or working memory.\n\nYour current conversation stays saved in History.`,
				confirmLabel: "Switch and bring messages",
			};
		case "new-chat":
			return {
				title: "Start a new chat?",
				body: "Your current conversation stays saved in History.",
				confirmLabel: "New chat",
			};
		case "reload":
			return {
				title: `Reload ${agent}?`,
				body: `This starts the conversation fresh. The current one stays saved in History.`,
				confirmLabel: "Reload",
				confirmCls: "mod-warning",
			};
	}
}

/**
 * Present a confirm modal and resolve with the user's decision.
 *
 * The returned promise never rejects — closing the modal (Escape / X)
 * resolves as "cancel".
 */
export function confirmSessionIntent(
	app: App,
	request: SessionIntentConfirmRequest,
	agentName?: string,
): Promise<SessionIntentDecision> {
	return new Promise<SessionIntentDecision>((resolve) => {
		const modal = new SessionIntentModal(app, request, agentName, resolve);
		modal.open();
	});
}

class SessionIntentModal extends Modal {
	private request: SessionIntentConfirmRequest;
	private agentName: string | undefined;
	private resolve: (decision: SessionIntentDecision) => void;
	private resolved = false;

	constructor(
		app: App,
		request: SessionIntentConfirmRequest,
		agentName: string | undefined,
		resolve: (decision: SessionIntentDecision) => void,
	) {
		super(app);
		this.request = request;
		this.agentName = agentName;
		this.resolve = resolve;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("agent-client-confirm-intent");

		const copy = getCopy(this.request, this.agentName);

		contentEl.createEl("h2", { text: copy.title });

		// Render body — split on \n for paragraph breaks
		for (const para of copy.body.split("\n\n")) {
			contentEl.createEl("p", {
				text: para,
				cls: "agent-client-confirm-intent-body",
			});
		}

		const buttonContainer = contentEl.createDiv({
			cls: "agent-client-confirm-intent-buttons",
		});

		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
		});
		cancelButton.addEventListener("click", () => {
			this.resolveAndClose("cancel");
		});

		const confirmButton = buttonContainer.createEl("button", {
			text: copy.confirmLabel,
			cls: copy.confirmCls || "mod-cta",
		});
		confirmButton.addEventListener("click", () => {
			// For switch-agent, the confirm action IS carry-over (the only
			// non-cancel option per settled decision #2).
			const decision: SessionIntentDecision =
				this.request.kind === "switch-agent" ? "carry-over" : "proceed-fresh";
			this.resolveAndClose(decision);
		});

		// Cancel is the safe default — focus it so Enter/Escape both back out.
		cancelButton.focus();
	}

	onClose() {
		// If the user closed via Escape or the X button without clicking a
		// button, treat as cancel.
		if (!this.resolved) {
			this.resolved = true;
			this.resolve("cancel");
		}
		const { contentEl } = this;
		contentEl.empty();
	}

	private resolveAndClose(decision: SessionIntentDecision) {
		this.resolved = true;
		this.resolve(decision);
		this.close();
	}
}
