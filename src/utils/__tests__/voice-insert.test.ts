/**
 * `insertTranscript` — puts dictated text into the composer at the cursor.
 *
 * Spec rules: insert at the cursor, never replace existing text (a selection is
 * kept, the text goes after it), keep words separated, and leave the cursor
 * right after the new words.
 */
import { describe, it, expect } from "vitest";
import { insertTranscript } from "../voice-insert";

describe("insertTranscript", () => {
	it("T01: appends after a trailing space with no extra space", () => {
		expect(
			insertTranscript(
				{ text: "Summarize ", selectionStart: 10, selectionEnd: 10 },
				"the last meeting",
			),
		).toEqual({
			kind: "inserted",
			text: "Summarize the last meeting",
			cursor: 26,
		});
	});

	it("adds a leading space when the cursor touches a word", () => {
		expect(
			insertTranscript(
				{ text: "Summarize", selectionStart: 9, selectionEnd: 9 },
				"the meeting",
			),
		).toEqual({
			kind: "inserted",
			text: "Summarize the meeting",
			cursor: 21,
		});
	});

	it("into an empty composer adds no spaces", () => {
		expect(
			insertTranscript(
				{ text: "", selectionStart: 0, selectionEnd: 0 },
				"hello there",
			),
		).toEqual({ kind: "inserted", text: "hello there", cursor: 11 });
	});

	it("trims the padding speech engines add around text", () => {
		expect(
			insertTranscript(
				{ text: "", selectionStart: 0, selectionEnd: 0 },
				"  hello there\n",
			),
		).toEqual({ kind: "inserted", text: "hello there", cursor: 11 });
	});

	it("mid-text: separates from the next word, cursor after the new words", () => {
		// "Fix | bug" with cursor right before "bug"
		expect(
			insertTranscript(
				{ text: "Fix bug", selectionStart: 4, selectionEnd: 4 },
				"the login",
			),
		).toEqual({ kind: "inserted", text: "Fix the login bug", cursor: 13 });
	});

	it("no trailing space before punctuation", () => {
		expect(
			insertTranscript(
				{ text: "Check .", selectionStart: 6, selectionEnd: 6 },
				"the logs",
			),
		).toEqual({ kind: "inserted", text: "Check the logs.", cursor: 14 });
	});

	it("never replaces a selection — inserts after it", () => {
		expect(
			insertTranscript(
				{ text: "keep this", selectionStart: 0, selectionEnd: 4 },
				"and",
			),
		).toEqual({ kind: "inserted", text: "keep and this", cursor: 8 });
	});

	it("a backwards selection still inserts after its far end", () => {
		expect(
			insertTranscript(
				{ text: "keep this", selectionStart: 4, selectionEnd: 0 },
				"and",
			),
		).toEqual({ kind: "inserted", text: "keep and this", cursor: 8 });
	});

	it("keeps a newline boundary without adding a space", () => {
		expect(
			insertTranscript(
				{ text: "line one\n", selectionStart: 9, selectionEnd: 9 },
				"line two",
			),
		).toEqual({ kind: "inserted", text: "line one\nline two", cursor: 17 });
	});

	it("an empty or blank transcript changes nothing", () => {
		const draft = { text: "draft", selectionStart: 5, selectionEnd: 5 };
		expect(insertTranscript(draft, "")).toEqual({ kind: "unchanged" });
		expect(insertTranscript(draft, "   \n ")).toEqual({ kind: "unchanged" });
	});

	it("clamps an out-of-range cursor to the end of the text", () => {
		expect(
			insertTranscript(
				{ text: "abc", selectionStart: 99, selectionEnd: 99 },
				"def",
			),
		).toEqual({ kind: "inserted", text: "abc def", cursor: 7 });
	});
});
