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
	findDocEmbedGaps,
	formatProblems,
	formatDocEmbedGaps,
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

	it("accounts for a chrome frame — expected height = manifest height + chromeHeight", () => {
		const g = entry("g", true);
		g.width = 1050;
		g.height = 570;
		g.frame = { chrome: "macos", chromeHeight: 28 };
		// The framed GIF file is content (570) + chrome bar (28) = 598 tall.
		const pass = findGifDimMismatches(
			[g],
			new Map([["g.gif", { width: 1050, height: 598 }]]),
		);
		expect(pass).toEqual([]);
		// A file at the bare content height (no chrome) is a mismatch.
		const fail = findGifDimMismatches(
			[g],
			new Map([["g.gif", { width: 1050, height: 570 }]]),
		);
		expect(fail).toHaveLength(1);
		expect(fail[0]).toMatchObject({
			expected: { width: 1050, height: 598 },
			actual: { width: 1050, height: 570 },
		});
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

describe("findDocEmbedGaps", () => {
	/** An entry whose image is committed and embedded on its declared docPage. */
	const healthy = {
		...entry("mid-stream-steering"),
		docPage: "docs/usage/queue-and-steering.md",
	} as ManifestEntry;

	it("passes when the declared docPage embeds the entry's image", () => {
		expect(
			findDocEmbedGaps({
				entries: [healthy],
				docPages: ["docs/usage/queue-and-steering.md"],
				refsByPage: {
					"docs/usage/queue-and-steering.md": ["mid-stream-steering.webp"],
				},
				presentImages: ["mid-stream-steering.webp"],
			}),
		).toEqual([]);
	});

	// The regression this guard exists for: the page is real, the image is
	// committed, and the page embeds NOTHING. checkConsistency reports clean.
	it("flags a committed image whose real docPage embeds no image at all", () => {
		const e = {
			...entry("interactive-buttons"),
			docPage: "docs/usage/interactive-buttons.md",
		} as ManifestEntry;
		const gaps = findDocEmbedGaps({
			entries: [e],
			docPages: ["docs/usage/interactive-buttons.md"],
			refsByPage: { "docs/usage/interactive-buttons.md": [] },
			presentImages: ["interactive-buttons.webp"],
		});
		expect(gaps).toHaveLength(1);
		expect(gaps[0].kind).toBe("not-embedded-in-doc-page");
		expect(gaps[0].name).toBe("interactive-buttons");

		// Pin the blind spot: the same input is CLEAN per checkConsistency,
		// because its orphan rule skips any image owning a manifest entry.
		expect(
			checkConsistency({
				entries: [e],
				presentImages: ["interactive-buttons.webp"],
				docRefs: [],
			}),
		).toEqual({ missing: [], orphans: [], brokenDocRefs: [] });
	});

	it("names the page that DOES embed the image when docPage is wrong", () => {
		const e = {
			...entry("shared-links-bubble"),
			docPage: "docs/usage/tabbed-sessions.md",
		} as ManifestEntry;
		const gaps = findDocEmbedGaps({
			entries: [e],
			docPages: [
				"docs/usage/tabbed-sessions.md",
				"docs/usage/shared-links.md",
			],
			refsByPage: {
				"docs/usage/tabbed-sessions.md": ["parallel-sessions.gif"],
				"docs/usage/shared-links.md": ["shared-links-bubble.webp"],
			},
			presentImages: ["shared-links-bubble.webp", "parallel-sessions.gif"],
		});
		expect(gaps).toHaveLength(1);
		expect(gaps[0].kind).toBe("not-embedded-in-doc-page");
		expect(gaps[0].detail).toContain("docs/usage/shared-links.md");
	});

	it("flags a docPage that does not resolve (missing docs/ prefix or .md)", () => {
		const gaps = findDocEmbedGaps({
			entries: [
				{
					...entry("mcp-oauth-signin-notice"),
					docPage: "usage/mcp-tools",
				} as ManifestEntry,
			],
			docPages: ["docs/usage/mcp-tools.md"],
			refsByPage: { "docs/usage/mcp-tools.md": [] },
			presentImages: ["mcp-oauth-signin-notice.webp"],
		});
		expect(gaps).toHaveLength(1);
		expect(gaps[0].kind).toBe("missing-doc-page");
	});

	it("flags a committed image referenced by no page when docPage is absent", () => {
		const gaps = findDocEmbedGaps({
			entries: [entry("language-setting")],
			docPages: ["docs/usage/language.md"],
			refsByPage: { "docs/usage/language.md": [] },
			presentImages: ["language-setting.webp"],
		});
		expect(gaps).toHaveLength(1);
		expect(gaps[0].kind).toBe("unreferenced-image");
	});

	it("allows a no-docPage entry embedded on any page (README hero, index)", () => {
		expect(
			findDocEmbedGaps({
				entries: [entry("multi-session")],
				docPages: ["README.md", "docs/index.md"],
				refsByPage: {
					"README.md": ["multi-session.webp"],
					"docs/index.md": ["multi-session-animated.gif"],
				},
				presentImages: ["multi-session.webp"],
			}),
		).toEqual([]);
	});

	it("resolves an animation entry against its .gif, not .webp", () => {
		expect(
			findDocEmbedGaps({
				entries: [
					{
						...entry("parallel-sessions", true),
						docPage: "docs/usage/tabbed-sessions.md",
					} as ManifestEntry,
				],
				docPages: ["docs/usage/tabbed-sessions.md"],
				refsByPage: {
					"docs/usage/tabbed-sessions.md": ["parallel-sessions.gif"],
				},
				presentImages: ["parallel-sessions.gif"],
			}),
		).toEqual([]);
	});

	it("skips pending entries (their image is uncommitted by design)", () => {
		expect(
			findDocEmbedGaps({
				entries: [
					{
						...entry("future-shot"),
						pending: true,
						docPage: "docs/usage/future.md",
					} as ManifestEntry,
				],
				docPages: [],
				refsByPage: {},
				presentImages: [],
			}),
		).toEqual([]);
	});

	it("skips an entry whose image is not committed (checkConsistency's job)", () => {
		expect(
			findDocEmbedGaps({
				entries: [
					{
						...entry("uncaptured"),
						docPage: "docs/usage/uncaptured.md",
					} as ManifestEntry,
				],
				docPages: ["docs/usage/uncaptured.md"],
				refsByPage: { "docs/usage/uncaptured.md": [] },
				presentImages: [],
			}),
		).toEqual([]);
	});

	it("reports at most one gap per entry, sorted by name", () => {
		const gaps = findDocEmbedGaps({
			entries: [
				{ ...entry("zulu"), docPage: "docs/nope.md" } as ManifestEntry,
				entry("alpha"),
			],
			docPages: ["docs/usage/x.md"],
			refsByPage: { "docs/usage/x.md": [] },
			presentImages: ["zulu.webp", "alpha.webp"],
		});
		expect(gaps.map((g) => g.name)).toEqual(["alpha", "zulu"]);
	});
});

describe("formatDocEmbedGaps", () => {
	it("renders one labeled line per gap and nothing when clean", () => {
		expect(formatDocEmbedGaps([])).toEqual([]);
		expect(
			formatDocEmbedGaps([
				{
					name: "interactive-buttons",
					kind: "not-embedded-in-doc-page",
					detail: 'docPage "docs/usage/interactive-buttons.md" does not embed it',
				},
			]),
		).toEqual([
			'docs-embed gap [not-embedded-in-doc-page] interactive-buttons: docPage "docs/usage/interactive-buttons.md" does not embed it',
		]);
	});
});
