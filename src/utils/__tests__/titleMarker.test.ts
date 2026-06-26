import { describe, it, expect } from "vitest";
import {
	parseLeadingTitle,
	TitleHeadBuffer,
	DEFAULT_TITLE_HEAD_CAP,
} from "../titleMarker";

describe("parseLeadingTitle — pure", () => {
	it("resolves a complete marker, stripping it and the trailing blank line", () => {
		const r = parseLeadingTitle(
			"<title>Fix scroll jitter</title>\n\nHere is the answer.",
		);
		expect(r).toEqual({
			status: "resolved",
			title: "Fix scroll jitter",
			remainder: "Here is the answer.",
		});
	});

	it("buffers while the head is still a viable marker prefix", () => {
		expect(parseLeadingTitle("<ti").status).toBe("buffering");
		expect(parseLeadingTitle("<title>Fix scroll").status).toBe("buffering");
		expect(parseLeadingTitle("").status).toBe("buffering");
		expect(parseLeadingTitle("   ").status).toBe("buffering");
	});

	it("passes through immediately when the reply diverges from the marker", () => {
		expect(parseLeadingTitle("Here is the answer")).toEqual({
			status: "passthrough",
			text: "Here is the answer",
		});
		// Diverges at the 3rd char (`<ta` is not a prefix of `<title>`).
		expect(parseLeadingTitle("<table>")).toEqual({
			status: "passthrough",
			text: "<table>",
		});
	});

	it("tolerates leading whitespace before the marker", () => {
		const r = parseLeadingTitle("\n  <title>Add dark mode</title>\n\nBody");
		expect(r).toEqual({
			status: "resolved",
			title: "Add dark mode",
			remainder: "Body",
		});
	});

	it("is case-insensitive on the tag names", () => {
		const r = parseLeadingTitle("<TITLE>Debug crash</TITLE>\n\nx");
		expect(r.status).toBe("resolved");
		if (r.status === "resolved") expect(r.title).toBe("Debug crash");
	});

	it("treats a newline before the close as malformed → passthrough", () => {
		expect(parseLeadingTitle("<title>oops\nstill going")).toEqual({
			status: "passthrough",
			text: "<title>oops\nstill going",
		});
	});

	it("passes through once the buffer exceeds the cap (never-closed marker)", () => {
		const long = "<title>" + "x".repeat(DEFAULT_TITLE_HEAD_CAP);
		expect(parseLeadingTitle(long).status).toBe("passthrough");
	});

	it("resolves an empty marker (title trimmed to empty)", () => {
		const r = parseLeadingTitle("<title></title>\n\nbody");
		expect(r).toEqual({
			status: "resolved",
			title: "",
			remainder: "body",
		});
	});
});

describe("TitleHeadBuffer — stateful", () => {
	it("T52 happy path: holds the head, then emits the stripped remainder + title", () => {
		const buf = new TitleHeadBuffer();
		// Whole marker + answer in one chunk.
		const r = buf.push("<title>Fix scroll jitter</title>\n\nThe answer.");
		expect(r.title).toBe("Fix scroll jitter");
		expect(r.emit).toBe("The answer.");
		expect(r.done).toBe(true);
		expect(buf.isActive).toBe(false);
	});

	it("reassembles a marker split across multiple chunks", () => {
		const buf = new TitleHeadBuffer();
		expect(buf.push("<ti")).toEqual({
			emit: null,
			title: null,
			done: false,
		});
		expect(buf.push("tle>Add ")).toEqual({
			emit: null,
			title: null,
			done: false,
		});
		expect(buf.push("dark mode</title>")).toEqual({
			// remainder empty so far → hold the emit, but title is resolved
			emit: null,
			title: "Add dark mode",
			done: true,
		});
		expect(buf.isActive).toBe(false);
	});

	it("emits the remainder when it arrives in the resolving chunk", () => {
		const buf = new TitleHeadBuffer();
		buf.push("<title>Explain merge vs rebase");
		const r = buf.push("</title>\n\nBoth integrate changes.");
		expect(r.title).toBe("Explain merge vs rebase");
		expect(r.emit).toBe("Both integrate changes.");
		expect(r.done).toBe(true);
	});

	it("no marker: abandons on first divergent chunk and releases it verbatim", () => {
		const buf = new TitleHeadBuffer();
		const r = buf.push("Here is a normal answer with no title.");
		expect(r.title).toBeNull();
		expect(r.emit).toBe("Here is a normal answer with no title.");
		expect(r.done).toBe(true);
	});

	it("T56 never-closed marker: flush() releases the held buffer at turn end", () => {
		const buf = new TitleHeadBuffer();
		const r = buf.push("<title>unterminated title text");
		expect(r.emit).toBeNull(); // still buffering
		expect(r.done).toBe(false);
		const tail = buf.flush();
		expect(tail).toBe("<title>unterminated title text");
		expect(buf.isActive).toBe(false);
	});

	it("flush() is a no-op once the buffer has finished", () => {
		const buf = new TitleHeadBuffer();
		buf.push("plain answer");
		expect(buf.flush()).toBeNull();
	});

	it("malformed marker (newline before close) passes through verbatim", () => {
		const buf = new TitleHeadBuffer();
		const r = buf.push("<title>broken\nanswer body");
		expect(r.title).toBeNull();
		expect(r.emit).toBe("<title>broken\nanswer body");
		expect(r.done).toBe(true);
	});

	it("empty/whitespace title resolves with title=null but still strips the marker", () => {
		const buf = new TitleHeadBuffer();
		const r = buf.push("<title>   </title>\n\nbody text");
		expect(r.title).toBeNull();
		expect(r.emit).toBe("body text");
		expect(r.done).toBe(true);
	});
});
