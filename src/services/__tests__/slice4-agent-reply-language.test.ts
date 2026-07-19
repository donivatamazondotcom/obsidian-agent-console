import { describe, it, expect } from "vitest";
import {
	composeObsidianSystemPrompt,
	normalizeObsidianSystemPromptSettings,
	DEFAULT_OBSIDIAN_SYSTEM_PROMPT_BLOCKS,
	respondInLanguageBlock,
	type ObsidianSystemPromptBlocks,
} from "../../utils/obsidian-system-prompt";
import {
	buildObsidianSystemPrompt,
	buildTitleRubric,
	type PreparePromptInput,
} from "../message-sender";

/**
 * Slice #4 — agent reply language.
 *
 * Two effects, one toggle (respondInLanguage, default on), emitted only when a
 * non-English reply language is active:
 *  1. a "reply in {language}" block in the Obsidian system prompt, and
 *  2. a "write the title in {language}" line appended to the agent-suggested
 *     title rubric.
 *
 * R1 discipline (learned rule — the F03 trap): real sends always pass
 * `contextNotes`, so the assertion enters at the PreparePromptInput seam the
 * runtime uses, not the pure composer alone — a prompt-block addition that
 * only a legacy path emitted was silently never sent (T52). The boundary-honest
 * tests below assert the hint/rubric via buildObsidianSystemPrompt /
 * buildTitleRubric on a real-send-shaped input (contextNotes set,
 * isFirstMessage true).
 */

const VAULT = "/Users/me/vault";
const allOn = (): ObsidianSystemPromptBlocks => ({
	...DEFAULT_OBSIDIAN_SYSTEM_PROMPT_BLOCKS,
});

/** A first-message input in the shape the real send path produces. */
function realSendInput(
	over: Partial<PreparePromptInput> = {},
): PreparePromptInput {
	return {
		message: "hello",
		vaultBasePath: VAULT,
		isFirstMessage: true,
		contextNotes: [], // real sends ALWAYS provide this (the F03 path)
		obsidianSystemPrompt: {
			blocks: allOn(),
			appendText: "",
			customText: "",
			mode: "options",
		},
		...over,
	};
}

describe("slice #4 — respondInLanguage default", () => {
	it("ships on by default", () => {
		expect(DEFAULT_OBSIDIAN_SYSTEM_PROMPT_BLOCKS.respondInLanguage).toBe(
			true,
		);
	});
});

describe("slice #4 — composer emits the reply-language block", () => {
	it("emits the block when a non-English reply language is set", () => {
		const out = composeObsidianSystemPrompt(
			{ blocks: allOn() },
			{ cwd: VAULT, vaultRoot: VAULT, replyLanguageName: "Korean" },
		);
		expect(out).toContain(respondInLanguageBlock("Korean"));
		expect(out).toContain("Reply in Korean");
	});

	it("omits the block when no reply language is set (English active)", () => {
		const out = composeObsidianSystemPrompt(
			{ blocks: allOn() },
			{ cwd: VAULT, vaultRoot: VAULT, replyLanguageName: null },
		);
		expect(out ?? "").not.toContain("Reply in");
	});

	it("omits the block when the toggle is off even with a language set", () => {
		const out = composeObsidianSystemPrompt(
			{ blocks: { ...allOn(), respondInLanguage: false } },
			{ cwd: VAULT, vaultRoot: VAULT, replyLanguageName: "Japanese" },
		);
		expect(out ?? "").not.toContain("Reply in Japanese");
	});
});

describe("slice #4 — reaches the agent on the real-send path (F03 guard)", () => {
	it("the reply-language block is in the system briefing with contextNotes set", () => {
		const briefing = buildObsidianSystemPrompt(
			realSendInput({ replyLanguageName: "Korean" }),
		);
		// Boundary-honest: this is the same function the contextNotes send path
		// calls (preparePromptWithContextNotes → buildObsidianSystemPrompt).
		expect(briefing).not.toBeNull();
		expect(briefing).toContain("Reply in Korean");
	});

	it("no reply-language line when English is active on the real-send path", () => {
		const briefing = buildObsidianSystemPrompt(
			realSendInput({ replyLanguageName: null }),
		);
		expect(briefing ?? "").not.toContain("Reply in");
	});
});

describe("slice #4 — title rubric carries the language line", () => {
	it("appends the language line under agent-suggested + non-English", () => {
		const rubric = buildTitleRubric(
			realSendInput({
				titleStrategy: "agent-suggested",
				replyLanguageName: "Korean",
			}),
		);
		expect(rubric).not.toBeNull();
		expect(rubric).toContain("Write the title in Korean.");
	});

	it("no language line when English is active", () => {
		const rubric = buildTitleRubric(
			realSendInput({
				titleStrategy: "agent-suggested",
				replyLanguageName: null,
			}),
		);
		expect(rubric).not.toBeNull();
		expect(rubric).not.toContain("Write the title in");
	});

	it("no rubric at all under agent-timestamp regardless of language", () => {
		const rubric = buildTitleRubric(
			realSendInput({
				titleStrategy: "agent-timestamp",
				replyLanguageName: "Korean",
			}),
		);
		expect(rubric).toBeNull();
	});

	it("omits the language line when the respondInLanguage toggle is off (I18N-I05)", () => {
		// The reply block gates on the toggle in compose; the title line must
		// honor the SAME toggle (spec D2). Regression for the H4 smoke finding:
		// toggle off + ko locale still asked for a Korean title.
		const rubric = buildTitleRubric(
			realSendInput({
				titleStrategy: "agent-suggested",
				replyLanguageName: "Korean",
				obsidianSystemPrompt: {
					blocks: { ...allOn(), respondInLanguage: false },
					appendText: "",
					customText: "",
					mode: "options",
				},
			}),
		);
		expect(rubric).not.toBeNull();
		expect(rubric).not.toContain("Write the title in");
	});
});

describe("slice #4 — normalizer", () => {
	it("defaults respondInLanguage to true for a pre-feature config", () => {
		const norm = normalizeObsidianSystemPromptSettings({
			blocks: {
				hostIdentity: true,
				rendering: true,
				workingDirectory: true,
				vaultCollaboration: true,
				interactiveButtons: true,
				// respondInLanguage absent (pre-slice-4 persisted config)
			},
		});
		expect(norm.blocks.respondInLanguage).toBe(true);
	});

	it("preserves an explicit respondInLanguage: false", () => {
		const norm = normalizeObsidianSystemPromptSettings({
			blocks: { respondInLanguage: false },
		});
		expect(norm.blocks.respondInLanguage).toBe(false);
	});
});
