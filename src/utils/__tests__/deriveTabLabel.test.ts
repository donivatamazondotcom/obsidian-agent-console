/**
 * I45 reproducing test — tab label overwritten by `<obsidian_system_instruction>`
 * wrapper on session replay.
 *
 * Exercises the REAL `deriveTabLabel` function that ChatPanel's
 * label-derivation effect calls. The shared import is the regression-guard
 * seam: if the production logic stops stripping injected wrapper blocks,
 * these tests fail.
 *
 * The key cases (wrapper-prefixed text) FAIL against the current
 * non-stripping implementation and PASS once deriveTabLabel strips
 * leading `<obsidian_*>...</obsidian_*>` context blocks.
 */
import { describe, it, expect } from "vitest";
import { deriveTabLabel } from "../deriveTabLabel";
import type { ChatMessage } from "../../types/chat";

function userMsg(text: string): ChatMessage {
	return {
		id: "u1",
		role: "user",
		content: [{ type: "text", text }],
		timestamp: new Date(),
	};
}

const SYS_INSTR =
	"<obsidian_system_instruction>\nWhen referencing notes in this vault, use [[Note Name]] wikilink syntax so they become clickable links.\n</obsidian_system_instruction>";

describe("deriveTabLabel — clean cases (current behavior, should stay green)", () => {
	it("returns the trimmed text of the first user message", () => {
		expect(deriveTabLabel([userMsg("Are you connected?")])).toBe(
			"Are you connected?",
		);
	});

	it("returns null when there is no user message", () => {
		expect(deriveTabLabel([])).toBeNull();
	});

	it("returns null when the first user message has only whitespace", () => {
		expect(deriveTabLabel([userMsg("   \n  ")])).toBeNull();
	});
});

describe("I45: deriveTabLabel strips injected wrapper blocks (RED until fix)", () => {
	it("strips a single leading system-instruction block and returns the user's text", () => {
		const msg = userMsg(`${SYS_INSTR}\n\nAre you connected?`);
		expect(deriveTabLabel([msg])).toBe("Are you connected?");
	});

	it("strips multiple stacked obsidian_* context blocks", () => {
		const text = [
			SYS_INSTR,
			"<obsidian_system_instruction>\nAlways leave a blank line before Markdown tables.\n</obsidian_system_instruction>",
			"",
			"hello",
		].join("\n");
		expect(deriveTabLabel([userMsg(text)])).toBe("hello");
	});

	it("strips an obsidian_mentioned_note context block", () => {
		const text =
			'<obsidian_mentioned_note ref="/x.md">\nsome note body\n</obsidian_mentioned_note>\n\nWhat does this say?';
		expect(deriveTabLabel([userMsg(text)])).toBe("What does this say?");
	});

	it("returns null when the message is ONLY wrapper blocks (no user text)", () => {
		expect(deriveTabLabel([userMsg(SYS_INSTR)])).toBeNull();
	});

	it("leaves text with no wrapper unchanged", () => {
		expect(deriveTabLabel([userMsg("plain message")])).toBe(
			"plain message",
		);
	});
});
