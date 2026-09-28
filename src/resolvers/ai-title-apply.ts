/**
 * F15 — Rename Tab With AI: decide whether (and as what) to apply an AI title
 * once the side-session request returns.
 *
 * - Manual rename wins: if the tab's label changed while the request ran, the
 *   user renamed it — never overwrite (title-equality guard, as F03).
 * - Collision with another open tab → filesystem-style numeric suffix, as for
 *   F03 auto-titles (the user asked for an AI title, not to pick a name).
 * Pure and total. Spec: [[F15 Rename Tab With AI]].
 */
import { suffixOnCollision, truncateLabel } from "../utils/tab-label";

export interface AiTitleApplyInput {
	/** Tab label when the request started. */
	labelAtStart: string;
	/** Tab label now, or null when the tab has closed. */
	currentLabel: string | null;
	/** Parsed AI title, or null when the agent gave nothing usable. */
	title: string | null;
	/** Labels of the other open tabs. */
	otherLabels: string[];
}

export type AiTitleApplyDecision =
	| { kind: "apply"; label: string }
	| {
			kind: "skip";
			reason: "tab-closed" | "user-renamed" | "no-title" | "unchanged";
	  };

export function decideAiTitleApply(
	input: AiTitleApplyInput,
): AiTitleApplyDecision {
	if (input.currentLabel === null) return { kind: "skip", reason: "tab-closed" };
	if (input.currentLabel !== input.labelAtStart) {
		return { kind: "skip", reason: "user-renamed" };
	}
	if (!input.title) return { kind: "skip", reason: "no-title" };
	const label = suffixOnCollision(
		truncateLabel(input.title),
		input.otherLabels,
	);
	if (label === input.currentLabel) return { kind: "skip", reason: "unchanged" };
	return { kind: "apply", label };
}
