import type { ChatMessage } from "../types/chat";

/**
 * Strip leading `<obsidian_TAG ...>...</obsidian_TAG>` context blocks that
 * the client injects into the agent prompt (system instructions, mentioned
 * notes, auto-mention context). On `session/load` replay the agent returns
 * the augmented text it received, so the stored first-message text can be
 * prefixed with these blocks — they must not become the tab label (I45).
 */
function stripContextBlocks(text: string): string {
	let result = text.trimStart();
	const leadingBlock = /^<obsidian_(\w+)\b[^>]*>[\s\S]*?<\/obsidian_\1>\s*/;
	while (leadingBlock.test(result)) {
		result = result.replace(leadingBlock, "");
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
