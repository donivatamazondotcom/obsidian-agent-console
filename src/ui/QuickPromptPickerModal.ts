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
import type { QuickPromptGesture } from "../services/quick-prompts-logic";
import { quickPromptGestureFromEvent } from "../utils/quick-prompt-gesture";

export class QuickPromptPickerModal extends FuzzySuggestModal<QuickPrompt> {
	constructor(
		app: App,
		private prompts: QuickPrompt[],
		private onChoose: (
			prompt: QuickPrompt,
			gesture: QuickPromptGesture,
		) => void,
	) {
		super(app);
		this.setPlaceholder("Search quick prompts — ↵ run, ⌘↵ new tab, ⌥↵ edit");

		// FuzzySuggestModal only wires plain Enter to choose an item, so the
		// modifier combos otherwise do nothing. Register them to select the
		// highlighted item WITH the modifier event, which flows through
		// onChooseItem → quickPromptGestureFromEvent(evt) → the 2×2:
		//   ⌘↵ new tab (background) · ⌘⇧↵ new tab + switch · ⌥↵ insert ·
		//   ⌘⌥↵ new tab + insert.
		const chooseWithModifier = (evt: KeyboardEvent): false => {
			(
				this as unknown as {
					chooser?: { useSelectedItem(evt: KeyboardEvent): void };
				}
			).chooser?.useSelectedItem(evt);
			return false;
		};
		this.scope.register(["Mod"], "Enter", chooseWithModifier);
		this.scope.register(["Mod", "Shift"], "Enter", chooseWithModifier);
		this.scope.register(["Alt"], "Enter", chooseWithModifier);
		this.scope.register(["Mod", "Alt"], "Enter", chooseWithModifier);
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
		this.onChoose(item, quickPromptGestureFromEvent(evt));
	}
}
