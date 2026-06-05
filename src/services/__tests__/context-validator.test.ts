import { describe, it, expect } from "vitest";
import {
	validateContextNotes,
	sanitizeContextNotes,
} from "../context-validator";
import { MAX_CONTEXT_NOTES } from "../../types/context";
import type { ContextNote } from "../../types/context";

const ok = (path: string): ContextNote => ({ path, source: "user", seen: false });

describe("validateContextNotes", () => {
	it("returns no violations for a well-formed array", () => {
		expect(validateContextNotes([ok("a.md"), ok("b.md")])).toEqual([]);
	});

	it("flags duplicate paths", () => {
		const v = validateContextNotes([ok("a.md"), ok("a.md")]);
		expect(v).toHaveLength(1);
		expect(v[0].code).toBe("duplicate-path");
	});

	it("flags over-cap", () => {
		const notes = Array.from({ length: MAX_CONTEXT_NOTES + 1 }, (_, i) =>
			ok(`n${i}.md`),
		);
		expect(validateContextNotes(notes).some((x) => x.code === "over-cap")).toBe(
			true,
		);
	});

	it("flags empty path, bad source, bad seen, non-object", () => {
		const codes = validateContextNotes([
			{ path: "", source: "user", seen: false },
			{ path: "b.md", source: "nope", seen: false },
			{ path: "c.md", source: "user", seen: "yes" },
			null,
		]).map((x) => x.code);
		expect(codes).toContain("empty-path");
		expect(codes).toContain("bad-source");
		expect(codes).toContain("bad-seen");
		expect(codes).toContain("not-an-object");
	});
});

describe("sanitizeContextNotes", () => {
	it("drops duplicates, keeping the first", () => {
		const { notes, dropped } = sanitizeContextNotes([ok("a.md"), ok("a.md")]);
		expect(notes.map((n) => n.path)).toEqual(["a.md"]);
		expect(dropped[0].code).toBe("duplicate-path");
	});

	it("drops malformed entries and caps length", () => {
		const raw = [
			ok("a.md"),
			null,
			{ path: "", source: "user", seen: false },
			...Array.from({ length: MAX_CONTEXT_NOTES }, (_, i) => ok(`x${i}.md`)),
		];
		const { notes } = sanitizeContextNotes(raw);
		expect(notes.length).toBe(MAX_CONTEXT_NOTES);
		expect(validateContextNotes(notes)).toEqual([]);
	});

	it("defaults a missing/invalid seen to false", () => {
		const { notes } = sanitizeContextNotes([
			{ path: "a.md", source: "agent" },
		]);
		expect(notes[0].seen).toBe(false);
	});
});
