/**
 * Which pickers the composer shows (pure, total).
 *
 * The composer toolbar and the chat header must agree on this: the header
 * leaves out the agent and the model when the composer already shows them.
 * So the decision lives here once, and both read it.
 *
 * Rules (unchanged from the toolbar's inline logic, pinned by
 * `composer-pickers-characterization.test.tsx`):
 * - When the agent sends config options, they supersede the legacy mode and
 *   model selectors entirely, per the ACP config-options spec. Each option
 *   with more than one choice (flattened across groups) shows. The legacy
 *   selectors stay hidden even when no config option has a second choice.
 * - Otherwise, a legacy selector shows when its list has more than one entry
 *   and the composer has a change handler for it.
 *
 * `matchesOptionKind` is the one place that decides whether a config option is
 * the agent's mode, model or effort (by id or by category). Every reader of
 * those options goes through it (header-agent, session-modes).
 *
 * Spec: [[Session Title in the Chat Header]] § Resolver 1.
 */
import {
	flattenConfigSelectOptions,
	type SessionConfigOption,
	type SessionModelState,
	type SessionModeState,
} from "../types/session";

export type OptionKind = "mode" | "model" | "thought_level";

export type ComposerPickers =
	| {
			source: "config";
			/** Options that render, in render order. Can be empty. */
			shown: SessionConfigOption[];
			/** A shown option is the agent's mode. */
			mode: boolean;
			/** A shown option is the agent's model. */
			model: boolean;
	  }
	/** At least one of `mode` / `model` is true; otherwise the result is `none`. */
	| { source: "legacy"; mode: boolean; model: boolean }
	| { source: "none" };

export interface ComposerPickersInput {
	configOptions?: SessionConfigOption[] | null;
	modes?: SessionModeState | null;
	models?: SessionModelState | null;
	/** The composer has a mode change handler. */
	canChangeMode: boolean;
	/** The composer has a model change handler. */
	canChangeModel: boolean;
}

export function matchesOptionKind(
	option: Pick<SessionConfigOption, "id" | "category">,
	kind: OptionKind,
): boolean {
	return option.id === kind || option.category === kind;
}

export function deriveComposerPickers(
	input: ComposerPickersInput,
): ComposerPickers {
	const configOptions = input.configOptions;
	if (configOptions && configOptions.length > 0) {
		const shown = configOptions.filter(
			(o) => flattenConfigSelectOptions(o.options).length > 1,
		);
		return {
			source: "config",
			shown,
			mode: shown.some((o) => matchesOptionKind(o, "mode")),
			model: shown.some((o) => matchesOptionKind(o, "model")),
		};
	}
	const mode =
		input.canChangeMode && (input.modes?.availableModes.length ?? 0) > 1;
	const model =
		input.canChangeModel && (input.models?.availableModels.length ?? 0) > 1;
	return mode || model
		? { source: "legacy", mode, model }
		: { source: "none" };
}
