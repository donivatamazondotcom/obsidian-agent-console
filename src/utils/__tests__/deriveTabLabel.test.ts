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

import {
	WIKI_LINK_INSTRUCTION,
	TABLE_INSTRUCTION,
	LATEX_MATH_INSTRUCTION,
	TITLE_RUBRIC,
} from "../system-instructions";

describe("TS-I02 / F03: deriveTabLabel strips leaked bare instructions + title marker (RED until fix)", () => {
	it("strips a single leading BARE system-instruction (embedded-path replay leak)", () => {
		// On session/load replay of an embedded-context-path first message,
		// the system instructions arrive as bare leading text (NOT
		// <obsidian_*>-wrapped), so the current stripper misses them and the
		// instruction would become the tab label.
		const text = `${WIKI_LINK_INSTRUCTION}\n\nFix the scroll jitter`;
		expect(deriveTabLabel([userMsg(text)])).toBe("Fix the scroll jitter");
	});

	it("strips multiple stacked bare instructions in any order", () => {
		const text = [
			TABLE_INSTRUCTION,
			WIKI_LINK_INSTRUCTION,
			LATEX_MATH_INSTRUCTION,
			"",
			"Add a dark mode toggle",
		].join("\n");
		expect(deriveTabLabel([userMsg(text)])).toBe("Add a dark mode toggle");
	});

	it("strips the bare F03 title rubric when it leaks to the head", () => {
		const text = `${TITLE_RUBRIC}\n\nExplain merge vs rebase`;
		expect(deriveTabLabel([userMsg(text)])).toBe(
			"Explain merge vs rebase",
		);
	});

	it("strips a leaked <title>…</title> marker (defense in depth)", () => {
		const text = "<title>Leaked title</title>\n\nActual user request";
		expect(deriveTabLabel([userMsg(text)])).toBe("Actual user request");
	});

	it("strips a mix of wrapped block + bare instruction + leaked marker", () => {
		const text = [
			SYS_INSTR, // <obsidian_system_instruction> wrapped
			WIKI_LINK_INSTRUCTION, // bare
			"<title>Some title</title>", // leaked marker
			"",
			"What does this code do?",
		].join("\n");
		expect(deriveTabLabel([userMsg(text)])).toBe("What does this code do?");
	});

	it("returns null when the message is ONLY leaked instructions (no user text)", () => {
		const text = `${WIKI_LINK_INSTRUCTION}\n${TITLE_RUBRIC}`;
		expect(deriveTabLabel([userMsg(text)])).toBeNull();
	});

	it("leaves a normal user message that merely mentions tables unchanged", () => {
		// Guard against over-stripping: a user message that isn't an exact
		// instruction sentinel must pass through untouched.
		expect(deriveTabLabel([userMsg("Always use my table format")])).toBe(
			"Always use my table format",
		);
	});
});

import {
	labelAlreadyReportedOnMount,
	shouldReportInterimLabel,
} from "../deriveTabLabel";

describe("TS-I03: restored tabs keep their persisted label (no interim re-derive)", () => {
	it("labelAlreadyReportedOnMount → true for a restored tab (has a session id)", () => {
		// A restored tab's persisted label (possibly an AI title) is
		// authoritative; the interim effect must start suppressed.
		expect(labelAlreadyReportedOnMount("sess-123")).toBe(true);
	});

	it("labelAlreadyReportedOnMount → false for a fresh tab (no restored session)", () => {
		expect(labelAlreadyReportedOnMount(null)).toBe(false);
		expect(labelAlreadyReportedOnMount(undefined)).toBe(false);
	});

	it("a restored tab does NOT report a derived label even though one derives", () => {
		// This is the clobber the bug caused: deriveTabLabel(replayed first
		// message) is non-null, but because the tab is restored
		// (alreadyReported=true) it must not overwrite the persisted label.
		expect(
			shouldReportInterimLabel({
				alreadyReported: labelAlreadyReportedOnMount("sess-123"),
				derivedLabel: "say \"Fix scroll jitter\" only",
			}),
		).toBe(false);
	});

	it("a fresh tab DOES report its first-message interim label", () => {
		expect(
			shouldReportInterimLabel({
				alreadyReported: labelAlreadyReportedOnMount(null),
				derivedLabel: "Fix the scroll jitter",
			}),
		).toBe(true);
	});

	it("a fresh tab with no derivable label reports nothing", () => {
		expect(
			shouldReportInterimLabel({
				alreadyReported: false,
				derivedLabel: null,
			}),
		).toBe(false);
	});
});
