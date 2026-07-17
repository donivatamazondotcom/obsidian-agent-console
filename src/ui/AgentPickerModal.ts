/**
 * Fuzzy picker for "New chat with agent…".
 *
 * Replaces the previous N per-agent "Switch agent to {X}" commands with a
 * single command that opens a FuzzySuggestModal listing every available agent
 * (built-in + custom). Picking one starts a fresh chat on that agent via the
 * injected onChoose callback (which routes through Plugin.startChat()).
 *
 * Sanctioned "choose one of N" picker per the Obsidian Modals guide.
 * See [[Agent Console Command Palette Rationalization]] § C2/D4.
 */

import { App, FuzzySuggestModal } from "obsidian";
import { t } from "../i18n";

export interface AgentChoice {
	id: string;
	displayName: string;
}

export class AgentPickerModal extends FuzzySuggestModal<AgentChoice> {
	private agents: AgentChoice[];
	private onChoose: (agentId: string) => void;

	constructor(
		app: App,
		agents: AgentChoice[],
		onChoose: (agentId: string) => void,
	) {
		super(app);
		this.agents = agents;
		this.onChoose = onChoose;
		this.setPlaceholder(t("modals.agentPicker.placeholder"));
	}

	getItems(): AgentChoice[] {
		return this.agents;
	}

	getItemText(item: AgentChoice): string {
		return item.displayName;
	}

	onChooseItem(item: AgentChoice): void {
		this.onChoose(item.id);
	}
}
