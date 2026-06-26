/**
 * System-instruction constants injected on the first message of a session.
 *
 * Single source of truth shared by:
 * - `services/message-sender.ts` (buildSystemInstructions) — injects them, and
 * - `utils/deriveTabLabel.ts` — strips any that leaked to the head of a
 *   replayed first user message so they never become a tab label (F4/TS-I02).
 *
 * Lives in `utils/` (pure strings, no imports) so both the services-layer
 * sender and the utils-layer label-deriver can import it without a cycle and
 * stay in sync: change an instruction here and the leak-stripper tracks it
 * automatically.
 *
 * The leak vector: on `session/load` replay, the embedded-context path sends
 * each instruction as a BARE leading `text` ContentBlock (not an
 * `<obsidian_*>`-wrapped block), so the agent's replayed first user message can
 * be prefixed with these sentences. `stripContextBlocks` strips wrapped blocks
 * only, so without this list a bare instruction (or the title rubric) could
 * surface as the label. See [[ACP AI Session Rename]] § F4.
 */

export const WIKI_LINK_INSTRUCTION =
	"When referencing notes in this vault, use [[Note Name]] wikilink syntax so they become clickable links.";

export const TABLE_INSTRUCTION =
	"Always leave a blank line before Markdown tables; without it Obsidian renders them as plain text.";

export const LATEX_MATH_INSTRUCTION =
	"This client uses Obsidian Flavored Markdown. For math, use $...$ for inline and $$...$$ for display (not \\(...\\) or \\[...\\]).";

/**
 * F03 — AI Session Rename title rubric.
 *
 * Injected as a system instruction on the first message only, and only when
 * `titleStrategy === 'agent-suggested'`. Asks the agent to emit a
 * `<title>…</title>` marker as the very first content of its reply, which the
 * head-buffer parser extracts and strips before render. Degrades gracefully:
 * an agent that ignores it just produces no marker, and the prompt-derived
 * interim label is kept.
 *
 * Style mirrors Claudian's battle-tested prompt (strong verb, sentence case,
 * no "Conversation with…"), tightened to 20–30 chars for tab real estate.
 */
export const TITLE_RUBRIC =
	"Begin your reply with a short session title wrapped exactly as " +
	"<title>your title here</title>, then a blank line, then your normal " +
	"answer. The title summarizes this request in about 20-30 characters, " +
	"sentence case, starting with a strong verb (e.g. Fix, Add, Explain, " +
	"Debug, Compare). Do not use quotes, trailing punctuation, or phrases " +
	'like "Conversation with" or "Help me". Emit the <title>…</title> only ' +
	"once, as the very first characters of this reply.";

/**
 * All injectable system instructions, for leak-stripping at the head of a
 * replayed first user message (deriveTabLabel). Order is not significant — the
 * stripper removes any leading occurrence repeatedly until none match.
 */
export const SYSTEM_INSTRUCTION_SENTINELS: readonly string[] = [
	WIKI_LINK_INSTRUCTION,
	TABLE_INSTRUCTION,
	LATEX_MATH_INSTRUCTION,
	TITLE_RUBRIC,
];
