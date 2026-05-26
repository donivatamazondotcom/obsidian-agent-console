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
	mkdirSync(path.join(root, "vault"), { recursive: true });
	mkdirSync(path.join(root, "prompts"), { recursive: true });
	return root;
}

describe("parseManifest", () => {
	it("parses a minimal valid manifest", () => {
		const json = JSON.stringify({
			entries: [
				{
					name: "ribbon-icon",
					output: "ribbon-icon.webp",
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
			output: "ribbon-icon.webp",
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
			output: "x.webp",
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
			output: "a.webp",
			width: 100,
			height: 100,
			crop: { x: 0, y: 0, width: 10, height: 10 },
		};
		expect(() =>
			validateManifest(
				{ entries: [entry, { ...entry, output: "b.webp" }] },
				root,
			),
		).toThrow(/duplicate/i);
	});

	it("rejects non-positive dimensions", () => {
		const root = makeFixtureRoot();
		const entry = {
			name: "bad",
			output: "x.webp",
			width: 0,
			height: 100,
			crop: { x: 0, y: 0, width: 10, height: 10 },
		} as ManifestEntry;
		expect(() => validateManifest({ entries: [entry] }, root)).toThrow(
			/width/,
		);
	});

	it("rejects crop region exceeding capture bounds is allowed (capture is upstream of crop)", () => {
		// We do NOT validate that crop fits inside (width, height) because the
		// crop region is in the source-screenshot coordinate space (full
		// Obsidian window), not the output-image coordinate space. This test
		// pins that decision so it isn't accidentally tightened.
		const root = makeFixtureRoot();
		const entry: ManifestEntry = {
			name: "huge-crop",
			output: "x.webp",
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
			output: "x.webp",
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
			output: "x.webp",
			width: 200,
			height: 200,
			crop: { x: 0, y: 0, width: 10, height: 10 },
			promptFile: "real.txt",
		};
		expect(() =>
			validateManifest({ entries: [entry] }, root),
		).not.toThrow();
	});

	it("accepts mobile flag", () => {
		const root = makeFixtureRoot();
		const entry: ManifestEntry = {
			name: "mobile-shot",
			output: "x.webp",
			width: 400,
			height: 800,
			crop: { x: 0, y: 0, width: 400, height: 800 },
			mobile: true,
		};
		expect(() =>
			validateManifest({ entries: [entry] }, root),
		).not.toThrow();
	});
});
