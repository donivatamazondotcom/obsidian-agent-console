import type { ChatMessage } from "../types/chat";
import { SYSTEM_INSTRUCTION_SENTINELS } from "./system-instructions";

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
