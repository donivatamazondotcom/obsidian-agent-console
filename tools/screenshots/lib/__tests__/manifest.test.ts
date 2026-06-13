/**
 * Tests for the screenshot manifest parser/validator.
 *
 * The manifest is the single source of truth for which screenshots get
 * regenerated, what UI state to drive to, and what crop/dimensions to apply.
 * Per [[Agent Console Screenshot Automation]] § Architecture Impact.
 *
 * TDD layer 1: pure logic, no I/O beyond a small fixture file existence
 * check that the validator does inline.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	parseManifest,
	validateManifest,
	type ManifestEntry,
} from "../manifest";

function makeFixtureRoot(): string {
	const root = mkdtempSync(path.join(tmpdir(), "screenshot-manifest-test-"));
	mkdirSync(path.join(root, "studio"), { recursive: true });
	mkdirSync(path.join(root, "prompts"), { recursive: true });
	return root;
}

describe("parseManifest", () => {
	it("parses a minimal valid manifest", () => {
		const json = JSON.stringify({
			entries: [
				{
					name: "ribbon-icon",
					width: 200,
					height: 200,
					crop: { x: 0, y: 40, width: 44, height: 200 },
				},
			],
		});
		const result = parseManifest(json);
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0].name).toBe("ribbon-icon");
	});

	it("throws on non-JSON input with a clear message", () => {
		expect(() => parseManifest("not json {")).toThrow(/manifest.*JSON/i);
	});

	it("throws when entries is missing", () => {
		expect(() => parseManifest("{}")).toThrow(/entries/);
	});

	it("throws when entries is not an array", () => {
		expect(() => parseManifest('{"entries": "nope"}')).toThrow(
			/entries.*array/,
		);
	});
});

describe("validateManifest", () => {
	it("accepts a valid manifest with no fixture references", () => {
		const root = makeFixtureRoot();
		const entry: ManifestEntry = {
			name: "ribbon-icon",
			width: 200,
			height: 200,
			crop: { x: 0, y: 40, width: 44, height: 200 },
		};
		expect(() =>
			validateManifest({ entries: [entry] }, root),
		).not.toThrow();
	});

	it("rejects empty name", () => {
		const root = makeFixtureRoot();
		const entry = {
			name: "",
			width: 100,
			height: 100,
			crop: { x: 0, y: 0, width: 10, height: 10 },
		} as ManifestEntry;
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/name/,
		);
	});

	it("rejects duplicate names", () => {
		const root = makeFixtureRoot();
		const entry: ManifestEntry = {
			name: "dup",
			width: 100,
			height: 100,
			crop: { x: 0, y: 0, width: 10, height: 10 },
		};
		expect(() =>
			validateManifest({ entries: [entry, { ...entry }] }, root),
		).toThrow(/duplicate/i);
	});

	it("rejects non-positive dimensions", () => {
		const root = makeFixtureRoot();
		const entry = {
			name: "bad",
			width: 0,
			height: 100,
			crop: { x: 0, y: 0, width: 10, height: 10 },
		} as ManifestEntry;
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/width/,
		);
	});

	it("allows crop region exceeding capture bounds (capture is upstream of crop)", () => {
		// We do NOT validate that crop fits inside (width, height) because the
		// crop region is in the source-screenshot coordinate space (full
		// Obsidian window), not the output-image coordinate space. This test
		// pins that decision so it isn't accidentally tightened.
		const root = makeFixtureRoot();
		const entry: ManifestEntry = {
			name: "huge-crop",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 9999, height: 9999 },
		};
		expect(() =>
			validateManifest({ entries: [entry] }, root),
		).not.toThrow();
	});

	it("rejects missing prompt fixture file when promptFile is set (T04)", () => {
		const root = makeFixtureRoot();
		const entry: ManifestEntry = {
			name: "with-prompt",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			promptFile: "missing.txt",
		};
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/prompt.*missing\.txt/,
		);
	});

	it("accepts existing prompt fixture file", () => {
		const root = makeFixtureRoot();
		writeFileSync(path.join(root, "prompts", "real.txt"), "hello");
		const entry: ManifestEntry = {
			name: "with-prompt",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			promptFile: "real.txt",
		};
		expect(() =>
			validateManifest({ entries: [entry] }, root),
		).not.toThrow();
	});

	it("rejects missing attachImage asset file", () => {
		const root = makeFixtureRoot();
		const entry: ManifestEntry = {
			name: "with-image",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			attachImage: "nope.png",
		};
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/attachImage.*nope\.png/,
		);
	});

	it("accepts existing attachImage asset file", () => {
		const root = makeFixtureRoot();
		mkdirSync(path.join(root, "assets"), { recursive: true });
		writeFileSync(path.join(root, "assets", "diagram.png"), "png-bytes");
		const entry: ManifestEntry = {
			name: "with-image",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			attachImage: "diagram.png",
		};
		expect(() =>
			validateManifest({ entries: [entry] }, root),
		).not.toThrow();
	});

	it("rejects empty attachImage string", () => {
		const root = makeFixtureRoot();
		const entry = {
			name: "with-image",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			attachImage: "   ",
		} as ManifestEntry;
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/attachImage.*non-empty string/,
		);
	});

	it("rejects revealSelectors with an empty member", () => {
		const root = makeFixtureRoot();
		const entry = {
			name: "reveal",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			revealSelectors: [""],
		} as ManifestEntry;
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/revealSelectors.*non-empty strings/,
		);
	});

	it("accepts revealSelectors of non-empty strings", () => {
		const root = makeFixtureRoot();
		const entry: ManifestEntry = {
			name: "reveal",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			revealSelectors: [".a", ".b"],
		};
		expect(() =>
			validateManifest({ entries: [entry] }, root),
		).not.toThrow();
	});

	it("accepts mobile flag", () => {
		const root = makeFixtureRoot();
		const entry: ManifestEntry = {
			name: "mobile-shot",
			width: 400,
			height: 800,
			crop: { x: 0, y: 0, width: 400, height: 800 },
			mobile: true,
		};
		expect(() =>
			validateManifest({ entries: [entry] }, root),
		).not.toThrow();
	});

	it("accepts initialState with openNote, clickRibbon, openChatView flags", () => {
		const root = makeFixtureRoot();
		writeFileSync(path.join(root, "studio", "Welcome.md"), "# Welcome\n");
		const entry: ManifestEntry = {
			name: "with-state",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			initialState: {
				openNote: "Welcome.md",
				clickRibbon: true,
				openChatView: true,
			},
		};
		expect(() =>
			validateManifest({ entries: [entry] }, root),
		).not.toThrow();
	});

	it("rejects initialState.openNote that doesn't exist in fixtures vault", () => {
		const root = makeFixtureRoot();
		const entry: ManifestEntry = {
			name: "missing-note",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			initialState: { openNote: "DoesNotExist.md" },
		};
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/note.*DoesNotExist\.md/,
		);
	});

	it("accepts initialState.openNote when the file exists in fixtures vault", () => {
		const root = makeFixtureRoot();
		writeFileSync(path.join(root, "studio", "Welcome.md"), "# Welcome\n");
		const entry: ManifestEntry = {
			name: "real-note",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			initialState: { openNote: "Welcome.md" },
		};
		expect(() =>
			validateManifest({ entries: [entry] }, root),
		).not.toThrow();
	});

	it("accepts approvalThreshold between 0 and 1", () => {
		const root = makeFixtureRoot();
		const entry: ManifestEntry = {
			name: "with-threshold",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			approvalThreshold: 0.05,
		};
		expect(() =>
			validateManifest({ entries: [entry] }, root),
		).not.toThrow();
	});

	it("rejects approvalThreshold outside [0, 1]", () => {
		const root = makeFixtureRoot();
		const entry: ManifestEntry = {
			name: "bad-threshold",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			approvalThreshold: 1.5,
		};
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/approvalThreshold/,
		);
	});

	it("accepts a non-negative minDistinctColors floor", () => {
		const root = makeFixtureRoot();
		const entry: ManifestEntry = {
			name: "with-floor",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			minDistinctColors: 800,
		};
		expect(() =>
			validateManifest({ entries: [entry] }, root),
		).not.toThrow();
	});

	it("accepts an entry with no minDistinctColors (global default applies at runtime)", () => {
		const root = makeFixtureRoot();
		const entry: ManifestEntry = {
			name: "no-floor",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 10, height: 10 },
		};
		expect(() =>
			validateManifest({ entries: [entry] }, root),
		).not.toThrow();
	});

	it("rejects a negative minDistinctColors", () => {
		const root = makeFixtureRoot();
		const entry = {
			name: "bad-floor",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			minDistinctColors: -1,
		} as ManifestEntry;
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/minDistinctColors/,
		);
	});

	it("rejects a non-finite minDistinctColors", () => {
		const root = makeFixtureRoot();
		const entry = {
			name: "nan-floor",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			minDistinctColors: Number.POSITIVE_INFINITY,
		} as ManifestEntry;
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/minDistinctColors/,
		);
	});
});

describe("validateManifest — Tier-1 editorial fields (rubric)", () => {
	function mk(extra: Partial<ManifestEntry>): ManifestEntry {
		return {
			name: "tier1",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			...extra,
		};
	}

	it("accepts a full set of valid Tier-1 fields", () => {
		const root = makeFixtureRoot();
		const e = mk({
			placement: "reference",
			purpose: "Shows the export action",
			differentiator: "Markdown export",
			mustShow: ".agent-client-export",
			caption: "Export the chat",
			altText: "The export action in the chat header",
		});
		expect(() => validateManifest({ entries: [e] }, root)).not.toThrow();
	});

	it("rejects an invalid placement value", () => {
		const root = makeFixtureRoot();
		const e = mk({ placement: "banner" as unknown as "hero" });
		expect(() => validateManifest({ entries: [e] }, root)).toThrow(
			/placement/,
		);
	});

	it("rejects an empty (whitespace-only) purpose", () => {
		const root = makeFixtureRoot();
		const e = mk({ purpose: "   " });
		expect(() => validateManifest({ entries: [e] }, root)).toThrow(
			/purpose/,
		);
	});

	it("rejects altText longer than 140 chars", () => {
		const root = makeFixtureRoot();
		const e = mk({ altText: "x".repeat(141) });
		expect(() => validateManifest({ entries: [e] }, root)).toThrow(/140/);
	});

	it('rejects altText starting with "image of"', () => {
		const root = makeFixtureRoot();
		const e = mk({ altText: "Image of the ribbon icon" });
		expect(() => validateManifest({ entries: [e] }, root)).toThrow(
			/image of/i,
		);
	});

	it("requires mustShow when placement is hero", () => {
		const root = makeFixtureRoot();
		const e = mk({ placement: "hero", purpose: "Hero shot" });
		expect(() => validateManifest({ entries: [e] }, root)).toThrow(
			/mustShow/,
		);
	});

	it("requires purpose when placement is feature", () => {
		const root = makeFixtureRoot();
		const e = mk({ placement: "feature", mustShow: ".x" });
		expect(() => validateManifest({ entries: [e] }, root)).toThrow(
			/purpose/,
		);
	});

	it("accepts hero placement with both purpose and mustShow", () => {
		const root = makeFixtureRoot();
		const e = mk({
			placement: "hero",
			purpose: "Tabbed sessions",
			mustShow: ".agent-client-tab-state-icon",
		});
		expect(() => validateManifest({ entries: [e] }, root)).not.toThrow();
	});
});

describe("validateManifest — minLegibilityScale (rubric P5)", () => {
	it("accepts a positive minLegibilityScale", () => {
		const root = makeFixtureRoot();
		const entry: ManifestEntry = {
			name: "with-legibility",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 400, height: 400 },
			minLegibilityScale: 2,
		};
		expect(() =>
			validateManifest({ entries: [entry] }, root),
		).not.toThrow();
	});

	it("accepts an entry with no minLegibilityScale (global default applies at runtime)", () => {
		const root = makeFixtureRoot();
		const entry: ManifestEntry = {
			name: "no-legibility",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 400, height: 400 },
		};
		expect(() =>
			validateManifest({ entries: [entry] }, root),
		).not.toThrow();
	});

	it("rejects a zero minLegibilityScale (meaningless — disables the floor)", () => {
		const root = makeFixtureRoot();
		const entry = {
			name: "zero-legibility",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 400, height: 400 },
			minLegibilityScale: 0,
		} as ManifestEntry;
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/minLegibilityScale/,
		);
	});

	it("rejects a negative minLegibilityScale", () => {
		const root = makeFixtureRoot();
		const entry = {
			name: "neg-legibility",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 400, height: 400 },
			minLegibilityScale: -1,
		} as ManifestEntry;
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/minLegibilityScale/,
		);
	});

	it("rejects a non-finite minLegibilityScale", () => {
		const root = makeFixtureRoot();
		const entry = {
			name: "nan-legibility",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 400, height: 400 },
			minLegibilityScale: Number.NaN,
		} as ManifestEntry;
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/minLegibilityScale/,
		);
	});
});

describe("validateManifest — forbidden* cleanliness fields (rubric P7)", () => {
	const base = (over: Partial<ManifestEntry>): ManifestEntry => ({
		name: "clean-entry",
		width: 200,
		height: 200,
		crop: { x: 0, y: 0, width: 400, height: 400 },
		...over,
	});

	it("accepts arrays of non-empty selector/text strings", () => {
		const root = makeFixtureRoot();
		expect(() =>
			validateManifest(
				{
					entries: [
						base({
							forbiddenSelectors: [".agent-client-unrelated-leaf"],
							forbiddenText: ["SecretCodename"],
						}),
					],
				},
				root,
			),
		).not.toThrow();
	});

	it("accepts an empty array (adds nothing to the defaults)", () => {
		const root = makeFixtureRoot();
		expect(() =>
			validateManifest(
				{ entries: [base({ forbiddenSelectors: [] })] },
				root,
			),
		).not.toThrow();
	});

	it("rejects a non-array forbiddenSelectors", () => {
		const root = makeFixtureRoot();
		const entry = base({
			forbiddenSelectors: ".not-an-array" as unknown as string[],
		});
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/forbiddenSelectors/,
		);
	});

	it("rejects empty/blank strings in forbiddenSelectors", () => {
		const root = makeFixtureRoot();
		const entry = base({ forbiddenSelectors: [".ok", "  "] });
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/forbiddenSelectors/,
		);
	});

	it("rejects empty/blank strings in forbiddenText", () => {
		const root = makeFixtureRoot();
		const entry = base({ forbiddenText: ["Auto-SA", ""] });
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/forbiddenText/,
		);
	});
});

describe("validateManifest — awaitSelector", () => {
	it("rejects an empty/whitespace awaitSelector", () => {
		const root = makeFixtureRoot();
		const entry = {
			name: "paused",
			width: 100,
			height: 100,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			awaitSelector: "  ",
		} as ManifestEntry;
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/awaitSelector/,
		);
	});

	it("accepts a non-empty awaitSelector", () => {
		const root = makeFixtureRoot();
		const entry: ManifestEntry = {
			name: "paused-ok",
			width: 100,
			height: 100,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			awaitSelector: ".agent-client-message-permission-request",
		};
		expect(() => validateManifest({ entries: [entry] }, root)).not.toThrow();
	});
});

describe("validateManifest — agentId", () => {
	it("rejects an empty/whitespace agentId", () => {
		const root = makeFixtureRoot();
		const entry = {
			name: "a",
			width: 100,
			height: 100,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			agentId: "  ",
		} as ManifestEntry;
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/agentId/,
		);
	});

	it("accepts a non-empty agentId", () => {
		const root = makeFixtureRoot();
		const entry: ManifestEntry = {
			name: "b",
			width: 100,
			height: 100,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			agentId: "gemini-cli",
		};
		expect(() => validateManifest({ entries: [entry] }, root)).not.toThrow();
	});
});

describe("validateManifest — animation (v2)", () => {
	function withAnimation(animation: unknown): ManifestEntry {
		return {
			name: "anim",
			width: 100,
			height: 100,
			crop: { x: 0, y: 0, width: 100, height: 100 },
			animation,
		} as unknown as ManifestEntry;
	}

	it("accepts a valid animation entry", () => {
		const root = makeFixtureRoot();
		const entry = withAnimation({
			fps: 4,
			maxBytes: 2_000_000,
			frames: [
				{ holdMs: 600 },
				{
					actions: [
						{ type: "click", selector: ".x", waitFor: ".y" },
						{ type: "draft", text: "hello" },
						{ type: "wait", selector: ".z" },
					],
					holdMs: 600,
				},
			],
		});
		expect(() =>
			validateManifest({ entries: [entry] }, root),
		).not.toThrow();
	});

	it("rejects empty frames", () => {
		const root = makeFixtureRoot();
		const entry = withAnimation({ fps: 4, maxBytes: 1000, frames: [] });
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/frames must be a non-empty array/,
		);
	});

	it("rejects non-positive fps", () => {
		const root = makeFixtureRoot();
		const entry = withAnimation({
			fps: 0,
			maxBytes: 1000,
			frames: [{ holdMs: 100 }],
		});
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/animation\.fps/,
		);
	});

	it("rejects non-positive maxBytes", () => {
		const root = makeFixtureRoot();
		const entry = withAnimation({
			fps: 4,
			maxBytes: 0,
			frames: [{ holdMs: 100 }],
		});
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/animation\.maxBytes/,
		);
	});

	it("rejects a non-positive holdMs", () => {
		const root = makeFixtureRoot();
		const entry = withAnimation({
			fps: 4,
			maxBytes: 1000,
			frames: [{ holdMs: 0 }],
		});
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/invalid holdMs/,
		);
	});

	it("rejects a click action without a selector", () => {
		const root = makeFixtureRoot();
		const entry = withAnimation({
			fps: 4,
			maxBytes: 1000,
			frames: [{ actions: [{ type: "click" }], holdMs: 100 }],
		});
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/click action needs a non-empty selector/,
		);
	});

	it("rejects a draft action without text", () => {
		const root = makeFixtureRoot();
		const entry = withAnimation({
			fps: 4,
			maxBytes: 1000,
			frames: [{ actions: [{ type: "draft", text: "" }], holdMs: 100 }],
		});
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/draft action needs non-empty text/,
		);
	});


	it("rejects an unknown action type", () => {
		const root = makeFixtureRoot();
		const entry = withAnimation({
			fps: 4,
			maxBytes: 1000,
			frames: [{ actions: [{ type: "teleport" }], holdMs: 100 }],
		});
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/unknown action type/,
		);
	});
});
