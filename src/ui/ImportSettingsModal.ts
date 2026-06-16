/**
 * Modal for importing settings from another agent plugin (e.g. Agent Client).
 *
 * Detects the first available import source, previews what would be imported
 * (agent definitions, default agent, custom-agent count, per-key status), and
 * — on confirm — applies the importable slice via the injected onImport
 * callback. Side-effect free until the user clicks Import. Fail-soft: any
 * detection/preview error renders the empty state rather than throwing.
 *
 * See [[Agent Console Settings Migration]].
 */

import { Modal, App, Notice } from "obsidian";
import type { AgentClientPluginSettings } from "../plugin";
import type {
	ImportAgentPreview,
	ImportPreview,
	ImportSource,
} from "../services/import/ImportSource";
import { firstDetectedSource } from "../services/import/registry";

export class ImportSettingsModal extends Modal {
	private sources: ImportSource[];
	private onImport: (
		slice: Partial<AgentClientPluginSettings>,
	) => Promise<void>;

	constructor(
		app: App,
		sources: ImportSource[],
		onImport: (slice: Partial<AgentClientPluginSettings>) => Promise<void>,
	) {
		super(app);
		this.sources = sources;
		this.onImport = onImport;
	}

	onOpen() {
		this.renderHeading();
		this.contentEl.createEl("p", {
			text: "Looking for importable settings…",
		});
		void this.load();
	}

	private renderHeading() {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Import settings" });
	}

	private async load() {
		let source: ImportSource | null = null;
		let preview: ImportPreview | null = null;
		try {
			source = await firstDetectedSource(this.sources);
			preview = source ? await source.preview() : null;
		} catch {
			// Fail soft — render the empty state below.
			source = null;
			preview = null;
		}
		this.renderHeading();
		if (!source || !preview) {
			this.renderEmpty();
			return;
		}
		this.renderPreview(source, preview);
	}

	private renderEmpty() {
		this.contentEl.createEl("p", {
			text: "No importable settings found from a supported plugin.",
		});
		const buttons = this.contentEl.createDiv({
			cls: "agent-client-import-buttons",
		});
		buttons
			.createEl("button", { text: "Close" })
			.addEventListener("click", () => this.close());
	}

	private renderPreview(source: ImportSource, preview: ImportPreview) {
		this.contentEl.createEl("p", {
			text: `Found ${source.displayName}. Import its agent configuration into Agent Console?`,
		});

		const list = this.contentEl.createEl("ul", {
			cls: "agent-client-import-agents",
		});
		let relinkCount = 0;
		for (const agent of preview.agents) {
			if (agent.keyStatus === "needs-relink") relinkCount += 1;
			const li = list.createEl("li");
			li.createSpan({
				text: agent.displayName,
				cls: "agent-client-import-agent-name",
			});
			li.createSpan({
				text: ` — ${agent.command || "(default command)"}`,
			});
			const statusLabel = this.keyStatusLabel(agent.keyStatus);
			if (statusLabel) {
				li.createSpan({
					text: ` · ${statusLabel}`,
					cls: "agent-client-import-key-status",
				});
			}
		}

		const meta =
			preview.customAgentCount > 0
				? `Default agent: ${preview.defaultAgentId} · ${preview.customAgentCount} custom agent(s)`
				: `Default agent: ${preview.defaultAgentId}`;
		this.contentEl.createEl("p", { text: meta });

		if (relinkCount > 0) {
			this.contentEl.createEl("p", {
				cls: "agent-client-import-relink",
				text: `${relinkCount} API key(s) can't be ported automatically — re-link them in settings after importing.`,
			});
		}

		const buttons = this.contentEl.createDiv({
			cls: "agent-client-import-buttons",
		});
		buttons
			.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => this.close());
		const importBtn = buttons.createEl("button", {
			text: "Import",
			cls: "mod-cta",
		});
		importBtn.addEventListener("click", () => {
			void this.doImport(source, preview, importBtn, relinkCount);
		});
	}

	private async doImport(
		source: ImportSource,
		preview: ImportPreview,
		importBtn: HTMLButtonElement,
		relinkCount: number,
	) {
		importBtn.disabled = true;
		try {
			const slice = await source.apply(preview);
			await this.onImport(slice);
			const relinkMsg =
				relinkCount > 0
					? ` Re-link ${relinkCount} API key(s) in settings.`
					: "";
			new Notice(
				`Agent Console: imported settings from ${source.displayName}.${relinkMsg}`,
			);
			this.close();
		} catch (error) {
			new Notice(
				`Agent Console: import failed. ${
					error instanceof Error ? error.message : "Unknown error"
				}`,
			);
			importBtn.disabled = false;
		}
	}

	private keyStatusLabel(status: ImportAgentPreview["keyStatus"]): string {
		switch (status) {
			case "by-reference":
				return "key ported";
			case "will-migrate-plaintext":
				return "key migrated";
			case "needs-relink":
				return "needs re-link";
			default:
				return "";
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
