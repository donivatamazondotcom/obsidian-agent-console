/**
 * The grey text after the chat title (pure, total).
 *
 * The header names the chat (its tab's title). After the title it adds only
 * what the composer doesn't show and the title doesn't already say:
 * - Agent: hidden when the composer's mode picker names it (Kiro, where a mode
 *   is a Kiro agent) or when the title is still the tab's default name, which
 *   starts with the agent's name. The "agent didn't load" warning (I207)
 *   always shows: it is the header's one warning.
 * - Model: shown when the composer has no model picker, or when the agent
 *   reported running a different model than the pick (Header Branding #8).
 *
 * No lifecycle input: connecting / asleep / busy live in the tab's status
 * icon, never in the header.
 *
 * Spec: [[Session Title in the Chat Header]] § Resolver 2.
 */
import type { ComposerPickers } from "./composer-pickers";
import type { HeaderAgent } from "./header-agent";

export type HeaderAgentExtra =
	| { kind: "label"; label: string }
	| { kind: "switched"; label: string; running: string }
	| { kind: "notLoaded"; label: string; running: string };

export interface HeaderExtras {
	agent: HeaderAgentExtra | null;
	model: string | null;
}

export interface HeaderExtrasInput {
	/** `deriveHeaderAgent` result. */
	agent: HeaderAgent;
	model: {
		/** `deriveHeaderModelName` result. */
		name: string | null;
		/** `deriveConfirmedModelDiffers` result. */
		confirmedDiffers: boolean;
	};
	/** `deriveComposerPickers` result: what the composer already shows. */
	composer: ComposerPickers;
	/** The agent's modes are its agents (`session.kiroCli`). */
	modesAreAgents: boolean;
	/** The tab still has its default name, which names the agent. */
	titleIsDefault: boolean;
}

function composerShows(composer: ComposerPickers, kind: "mode" | "model"): boolean {
	switch (composer.source) {
		case "config":
		case "legacy":
			return composer[kind];
		case "none":
			return false;
	}
}

function agentExtra(input: HeaderExtrasInput): HeaderAgentExtra | null {
	const pickerNamesAgent =
		input.modesAreAgents && composerShows(input.composer, "mode");
	const agent = input.agent;
	switch (agent.kind) {
		case "notLoaded":
			return { kind: "notLoaded", label: agent.label, running: agent.running };
		case "switched":
			return pickerNamesAgent
				? null
				: { kind: "switched", label: agent.label, running: agent.running };
		case "configured":
			return input.titleIsDefault || pickerNamesAgent
				? null
				: { kind: "label", label: agent.label };
	}
}

export function deriveHeaderExtras(input: HeaderExtrasInput): HeaderExtras {
	const { name, confirmedDiffers } = input.model;
	const model =
		name !== null &&
		(!composerShows(input.composer, "model") || confirmedDiffers)
			? name
			: null;
	return { agent: agentExtra(input), model };
}
