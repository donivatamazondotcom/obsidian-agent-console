/**
 * Tests for the screenshot consistency check (v3) pure logic.
 *
 * Test contract: tools/screenshots/lib/__tests__/check.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
	derivedImageName,
	checkConsistency,
	findGifDimMismatches,
	formatProblems,
	pendingEntryNames,
} from "../check";
import type { ManifestEntry } from "../manifest";

function entry(name: string, animation = false): ManifestEntry {
	return {
		name,
		width: 100,
		height: 100,
		crop: { x: 0, y: 0, width: 100, height: 100 },
		...(animation
			? { animation: { fps: 5, maxBytes: 1000, frames: [{ holdMs: 100 }] } }
			: {}),
	} as ManifestEntry;
}

describe("derivedImageName", () => {
	it("uses .webp for still entries and .gif for animation entries", () => {
		expect(derivedImageName(entry("ribbon-icon"))).toBe("ribbon-icon.webp");
		expect(derivedImageName(entry("parallel-sessions", true))).toBe(
			"parallel-sessions.gif",
		);
	});
});

describe("pendingEntryNames", () => {
	it("returns only pending entry names, sorted", () => {
		const a = { ...entry("zebra"), pending: true } as ManifestEntry;
		const b = entry("captured");
		const c = { ...entry("alpha"), pending: true } as ManifestEntry;
		expect(pendingEntryNames([a, b, c])).toEqual(["alpha", "zebra"]);
	});

	it("is empty when nothing is pending (release gate passes)", () => {
		expect(pendingEntryNames([entry("a"), entry("b", true)])).toEqual([]);
	});
});

describe("checkConsistency", () => {
	it("passes when every entry has an image and there are no orphans/broken refs", () => {
		const r = checkConsistency({
			entries: [entry("a"), entry("b", true)],
			presentImages: ["a.webp", "b.gif"],
			docRefs: ["a.webp", "b.gif"],
		});
		expect(r).toEqual({ missing: [], orphans: [], brokenDocRefs: [] });
	});

	it("flags a manifest entry with no committed image", () => {
		const r = checkConsistency({
			entries: [entry("a")],
			presentImages: [],
			docRefs: [],
		});
		expect(r.missing).toEqual(["a.webp"]);
	});

	it("flags an orphan image (no entry, not referenced in docs)", () => {
		const r = checkConsistency({
			entries: [entry("a")],
			presentImages: ["a.webp", "old.webp"],
			docRefs: [],
		});
		expect(r.orphans).toEqual(["old.webp"]);
	});

	it("does NOT flag an image referenced only by docs (e.g. a README hero)", () => {
		const r = checkConsistency({
			entries: [],
			presentImages: ["hero.webp"],
			docRefs: ["hero.webp"],
		});
		expect(r.orphans).toEqual([]);
	});

	it("flags a docs reference whose image is not on disk", () => {
		const r = checkConsistency({
			entries: [],
			presentImages: [],
			docRefs: ["gone.gif"],
		});
		expect(r.brokenDocRefs).toEqual(["gone.gif"]);
	});

	it("does NOT flag a pending entry that has no committed image", () => {
		const pending = { ...entry("planned"), pending: true } as ManifestEntry;
		const r = checkConsistency({
			entries: [entry("a"), pending],
			presentImages: ["a.webp"],
			docRefs: [],
		});
		expect(r.missing).toEqual([]);
	});

	it("does not flag a pending entry's later-committed image as an orphan", () => {
		const pending = { ...entry("planned"), pending: true } as ManifestEntry;
		const r = checkConsistency({
			entries: [pending],
			presentImages: ["planned.webp"],
			docRefs: [],
		});
		expect(r.orphans).toEqual([]);
	});
});

describe("findGifDimMismatches", () => {
	it("flags a gif whose dimensions differ from the manifest", () => {
		const e = entry("g", true);
		e.width = 628;
		e.height = 184;
		const m = findGifDimMismatches(
			[e],
			new Map([["g.gif", { width: 628, height: 200 }]]),
		);
		expect(m).toHaveLength(1);
		expect(m[0]).toMatchObject({
			name: "g.gif",
			expected: { width: 628, height: 184 },
			actual: { width: 628, height: 200 },
		});
	});

	it("passes when gif dims match, and ignores still (webp) entries", () => {
		const g = entry("g", true);
		g.width = 628;
		g.height = 184;
		const s = entry("s"); // webp — must be ignored even with a dims entry present
		const m = findGifDimMismatches(
			[g, s],
			new Map([
				["g.gif", { width: 628, height: 184 }],
				["s.webp", { width: 1, height: 1 }],
			]),
		);
		expect(m).toEqual([]);
	});
});

describe("formatProblems", () => {
	it("returns an empty list when clean", () => {
		expect(
			formatProblems({ missing: [], orphans: [], brokenDocRefs: [] }, []),
		).toEqual([]);
	});

	it("formats each problem class", () => {
		const p = formatProblems(
			{ missing: ["a.webp"], orphans: ["o.webp"], brokenDocRefs: ["b.gif"] },
			[
				{
					name: "g.gif",
					expected: { width: 1, height: 2 },
					actual: { width: 3, height: 4 },
				},
			],
		);
		expect(
			p.some((x) => x.includes("missing committed image") && x.includes("a.webp")),
		).toBe(true);
		expect(
			p.some((x) => x.includes("orphan image") && x.includes("o.webp")),
		).toBe(true);
		expect(
			p.some(
				(x) => x.includes("docs reference a missing image") && x.includes("b.gif"),
			),
		).toBe(true);
		expect(
			p.some((x) => x.includes("g.gif") && x.includes("3x4") && x.includes("1x2")),
		).toBe(true);
	});
});
