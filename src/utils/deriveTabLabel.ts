import type { ChatMessage } from "../types/chat";
import { SYSTEM_INSTRUCTION_SENTINELS } from "./system-instructions";
import type { TitleStrategy } from "../types/title-strategy";

/**
 * Strip leading injected context from the head of a (possibly replayed) first
 * user message so it never becomes the tab label.
 *
 * Three leak shapes, stripped repeatedly (in any order) until the head is
 * clean:
 *  1. `<obsidian_TAG …>…</obsidian_TAG>` wrapped blocks — system instructions,
 *     mentioned notes, auto-mention context (the original I45 fix). On
 *     `session/load` replay the agent returns the augmented text it received.
 *  2. A leaked `<title>…</title>` marker (F03) — defense in depth, in case the
 *     head-buffer strip is ever bypassed on a replay path.
 *  3. BARE system-instruction sentences (F4/TS-I02) — the embedded-context path
 *     sends each instruction as a bare leading `text` block (NOT wrapped), so a
 *     replayed embedded-path first message can be prefixed with them. Matched
 *     against the shared SYSTEM_INSTRUCTION_SENTINELS source of truth.
 */
function stripContextBlocks(text: string): string {
	const leadingBlock = /^<obsidian_(\w+)\b[^>]*>[\s\S]*?<\/obsidian_\1>\s*/;
	const leadingTitle = /^<title\b[^>]*>[\s\S]*?<\/title>\s*/i;

	let result = text.trimStart();
	let changed = true;
	while (changed) {
		changed = false;

		if (leadingBlock.test(result)) {
			result = result.replace(leadingBlock, "").trimStart();
			changed = true;
			continue;
		}

		if (leadingTitle.test(result)) {
			result = result.replace(leadingTitle, "").trimStart();
			changed = true;
			continue;
		}

		for (const sentinel of SYSTEM_INSTRUCTION_SENTINELS) {
			if (result.startsWith(sentinel)) {
				result = result.slice(sentinel.length).trimStart();
				changed = true;
				break;
			}
		}
	}
	return result;
}

/**
 * Derive a tab label from the first user message in a conversation.
 *
 * Extracted from ChatPanel's label-derivation effect so the logic is
 * unit-testable in isolation (I45). Both ChatPanel and the test import
 * this function — the shared seam is what makes the test a real
 * regression guard rather than a tautology.
 *
 * Returns the trimmed label text with injected context blocks removed, or
 * null if there is no usable first user message text.
 */
export function deriveTabLabel(messages: ChatMessage[]): string | null {
	const firstUserMsg = messages.find((m) => m.role === "user");
	if (!firstUserMsg) return null;

	const textBlock = firstUserMsg.content.find(
		(block) =>
			block.type === "text" || block.type === "text_with_context",
	);
	const text = textBlock && "text" in textBlock ? textBlock.text : "";
	const trimmed = stripContextBlocks(text).trim();
	return trimmed ? trimmed : null;
}

/**
 * TS-I03 — initial value for ChatPanel's `labelReportedRef`.
 *
 * A restored tab already carries its persisted label (which may be an
 * AI-suggested title from a prior session). The interim first-message label
 * effect must NOT re-derive a label from the replayed first message and
 * overwrite it — that clobbered the persisted AI title back to the
 * first-message text on every restart, and the clobbered value was then
 * re-persisted (T53 failure, 2026-06-25).
 *
 * So a restored tab (one with a persisted/restored sessionId) starts with the
 * label "already reported" — the persisted label wins. A fresh tab (no
 * restored session) starts false, so its first typed message still derives an
 * interim label. A new chat resets the ref to false elsewhere, re-enabling
 * derivation for the new conversation.
 */
export function labelAlreadyReportedOnMount(
	restoredSessionId: string | null | undefined,
): boolean {
	return Boolean(restoredSessionId);
}

/**
 * TS-I03 — whether the interim first-message label effect should report a
 * derived label this run. Reports only when the label has not already been
 * reported (covers restored tabs via {@link labelAlreadyReportedOnMount}) and
 * a non-null label was actually derived.
 *
 * TS-I04 — additionally gated by `titleStrategy`: under `agent-timestamp` the
 * tab keeps its agent-name + timestamp default and never derives a label from
 * the prompt or response (T58). Under `agent-suggested` the derived label is
 * the interim shown until the AI title resolves; under `prompt-derived` it is
 * the final label.
 */
export function shouldReportInterimLabel(args: {
	alreadyReported: boolean;
	derivedLabel: string | null;
	titleStrategy: TitleStrategy;
}): boolean {
	if (args.titleStrategy === "agent-timestamp") return false;
	return !args.alreadyReported && args.derivedLabel !== null;
}
