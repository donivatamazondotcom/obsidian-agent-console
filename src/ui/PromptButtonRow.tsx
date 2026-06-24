import * as React from "react";
import type { PromptDefinition } from "../types/prompt";

/**
 * A wrapping row of prompt-library buttons, rendered just above the context
 * strip in the chat panel. Each button launches its prompt in the current tab
 * (pin active note → apply model/mode → send). Buttons wrap onto multiple rows
 * when many prompts match.
 *
 * Renders nothing when there are no matching prompts, so it adds no chrome to a
 * panel with an empty / unconfigured library.
 */
export interface PromptButtonRowProps {
	prompts: PromptDefinition[];
	/** Launch a prompt. Disabled buttons never call this. */
	onLaunch: (prompt: PromptDefinition) => void;
	/** When true, buttons are disabled (e.g. a turn is in flight). */
	disabled?: boolean;
}

export function PromptButtonRow({
	prompts,
	onLaunch,
	disabled = false,
}: PromptButtonRowProps) {
	if (prompts.length === 0) return null;

	return (
		<div
			className="agent-console-prompt-row"
			role="group"
			aria-label="Prompt library"
		>
			{prompts.map((prompt) => (
				<button
					key={prompt.path}
					type="button"
					className="agent-console-prompt-button"
					title={prompt.description}
					disabled={disabled}
					onClick={() => onLaunch(prompt)}
				>
					{prompt.description}
				</button>
			))}
		</div>
	);
}
