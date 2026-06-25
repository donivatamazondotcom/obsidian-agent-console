/**
 * QuickPromptPickerModal — the searchable "Quick prompt picker" surface.
 *
 * Lists every quick prompt; fuzzy search is provided by Obsidian's
 * `FuzzySuggestModal` (sanctioned "choose one of N" picker, same as
 * `AgentPickerModal`). Choosing a prompt fires it by default; holding ⌥ or ⇧
 * while choosing inserts the resolved text into the composer instead (the
 * fire-default / modifier-insert convention). The fire/insert outcome is then
 * decided by the engine against the live composer/queue/selection state — the
 * picker only reports which prompt and whether a tweak modifier was held.
 *
 * See [[Agent Console Quick Prompts and Workflows]] § Three surfaces / Picker.
 */

import { App, FuzzySuggestModal } from "obsidian";
import type { QuickPrompt } from "../types/quick-prompt";

/** True when a tweak modifier (⇧ or ⌥) was held during the choose event. */
export function isInsertModifier(evt: MouseEvent | KeyboardEvent | undefined): boolean {
	return !!evt && (evt.shiftKey || evt.altKey);
}

export class QuickPromptPickerModal extends FuzzySuggestModal<QuickPrompt> {
	constructor(
		app: App,
		private prompts: QuickPrompt[],
		private onChoose: (
			prompt: QuickPrompt,
			opts: { modifier: boolean },
		) => void,
	) {
		super(app);
		this.setPlaceholder("Search quick prompts — ↵ fire, ⌥↵ insert");
	}

	getItems(): QuickPrompt[] {
		return this.prompts;
	}

	getItemText(item: QuickPrompt): string {
		return item.label;
	}

	onChooseItem(
		item: QuickPrompt,
		evt?: MouseEvent | KeyboardEvent,
	): void {
		this.onChoose(item, { modifier: isInsertModifier(evt) });
	}
}
