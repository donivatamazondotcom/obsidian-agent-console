/**
 * V01 — fence extraction respects outer-fence nesting; unclosed fences stay
 * pending; offsets span the block for segmentation.
 *
 * Spec: "Agent Console Agent-Emitted Interactive Prompts" § Fence robustness.
 */
import { describe, expect, it } from "vitest";
import { extractA2uiFences } from "../fence-extractor";

const ENVELOPE = '{"version":"v1.0","createSurface":{"surfaceId":"x-1a2b"}}';

describe("extractA2uiFences", () => {
	it("extracts a single closed a2ui fence with its body", () => {
		const md = `Pick one:\n\n\`\`\`a2ui\n${ENVELOPE}\n\`\`\`\n\nOr type it.`;
		const fences = extractA2uiFences(md);
		expect(fences).toHaveLength(1);
		expect(fences[0].body).toBe(ENVELOPE);
		expect(fences[0].closed).toBe(true);
	});

	it("reports offsets spanning the whole fence block", () => {
		const md = `before\n\`\`\`a2ui\n${ENVELOPE}\n\`\`\`\nafter`;
		const [fence] = extractA2uiFences(md);
		const block = md.slice(fence.start, fence.end);
		expect(block.startsWith("```a2ui")).toBe(true);
		expect(block.trimEnd().endsWith("```")).toBe(true);
		expect(block).toContain(ENVELOPE);
	});

	it("extracts multiple sibling fences in order", () => {
		const md = `\`\`\`a2ui\n${ENVELOPE}\n\`\`\`\n\nmiddle\n\n\`\`\`a2ui\n${ENVELOPE}\n\`\`\`\n`;
		const fences = extractA2uiFences(md);
		expect(fences).toHaveLength(2);
		expect(fences[0].end).toBeLessThanOrEqual(fences[1].start);
	});

	it("ignores an a2ui fence quoted inside a 4-backtick outer fence (V01)", () => {
		const md = `Example:\n\n\`\`\`\`markdown\n\`\`\`a2ui\n${ENVELOPE}\n\`\`\`\n\`\`\`\`\n`;
		expect(extractA2uiFences(md)).toHaveLength(0);
	});

	it("ignores an a2ui fence inside a ```markdown outer fence", () => {
		// A 3-backtick outer fence: the inner ```a2ui line CLOSES the outer
		// fence per CommonMark, so no valid a2ui fence body follows.
		const md = "```markdown\nsome text\n```a2ui\n" + ENVELOPE + "\n```\n";
		expect(extractA2uiFences(md)).toHaveLength(0);
	});

	it("ignores an a2ui fence inside a tilde outer fence", () => {
		const md = `~~~text\n\`\`\`a2ui\n${ENVELOPE}\n\`\`\`\n~~~\n`;
		expect(extractA2uiFences(md)).toHaveLength(0);
	});

	it("resumes candidacy after an outer fence closes", () => {
		const md =
			"````markdown\n```a2ui\nquoted\n```\n````\n\n" +
			`\`\`\`a2ui\n${ENVELOPE}\n\`\`\`\n`;
		const fences = extractA2uiFences(md);
		expect(fences).toHaveLength(1);
		expect(fences[0].body).toBe(ENVELOPE);
	});

	it("marks an unclosed trailing fence as not closed (streaming partial)", () => {
		const md = `Choose:\n\`\`\`a2ui\n${ENVELOPE}`;
		const fences = extractA2uiFences(md);
		expect(fences).toHaveLength(1);
		expect(fences[0].closed).toBe(false);
		expect(fences[0].end).toBe(md.length);
	});

	it("ignores fences with other languages and bare fences", () => {
		const md = "```json\n{}\n```\n\n```\nplain\n```\n";
		expect(extractA2uiFences(md)).toHaveLength(0);
	});

	it("does not match a2ui-prefixed languages", () => {
		const md = `\`\`\`a2ui-next\n${ENVELOPE}\n\`\`\`\n`;
		expect(extractA2uiFences(md)).toHaveLength(0);
	});

	it("accepts trailing whitespace after the info string", () => {
		const md = "```a2ui \n" + ENVELOPE + "\n```\n";
		const fences = extractA2uiFences(md);
		expect(fences).toHaveLength(1);
	});

	it("accepts a longer-than-3-backtick a2ui fence", () => {
		const md = `\`\`\`\`a2ui\n${ENVELOPE}\n\`\`\`\`\n`;
		const fences = extractA2uiFences(md);
		expect(fences).toHaveLength(1);
		expect(fences[0].body).toBe(ENVELOPE);
	});

	it("returns empty for empty or fence-free text", () => {
		expect(extractA2uiFences("")).toHaveLength(0);
		expect(extractA2uiFences("just prose\nwith lines")).toHaveLength(0);
	});
});
