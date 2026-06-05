import { describe, it, expect } from "vitest";
import { computeProvisionalPath } from "../provisional-context";
import { MAX_CONTEXT_NOTES } from "../../types/context";
import type { ContextNote } from "../../types/context";

const note = (path: string): ContextNote => ({
	path,
	source: "user",
	seen: false,
});

const base = {
	settingOn: true,
	suppressed: false,
	messageCount: 0,
	activeNotePath: "B.md" as string | null,
	committed: [] as ContextNote[],
};

describe("computeProvisionalPath (Decision #26, I68)", () => {
	it("shows the active note on a fresh chat", () => {
		expect(computeProvisionalPath(base)).toBe("B.md");
	});

	it("hides when the setting is off", () => {
		expect(computeProvisionalPath({ ...base, settingOn: false })).toBeNull();
	});

	it("hides when suppressed (× sticky)", () => {
		expect(computeProvisionalPath({ ...base, suppressed: true })).toBeNull();
	});

	it("hides after the first message (freeze)", () => {
		expect(computeProvisionalPath({ ...base, messageCount: 1 })).toBeNull();
	});

	it("hides when there is no active note", () => {
		expect(
			computeProvisionalPath({ ...base, activeNotePath: null }),
		).toBeNull();
	});

	it("hides when the active note is already committed (no dup)", () => {
		expect(
			computeProvisionalPath({ ...base, committed: [note("B.md")] }),
		).toBeNull();
	});

	it("shows the active note alongside other committed notes (multi-add)", () => {
		expect(
			computeProvisionalPath({ ...base, committed: [note("A.md")] }),
		).toBe("B.md");
	});

	it("hides at cap", () => {
		const committed = Array.from({ length: MAX_CONTEXT_NOTES }, (_, i) =>
			note(`n${i}.md`),
		);
		expect(computeProvisionalPath({ ...base, committed })).toBeNull();
	});
});
