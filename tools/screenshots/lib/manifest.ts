/**
 * Screenshot manifest schema, parser, and validator.
 *
 * The manifest is a JSON file at `tools/screenshots/manifest.json` listing
 * each screenshot the docs site needs. The driver reads it, drives a
 * separately-launched Obsidian instance through each entry's UI state,
 * captures via `obsidian dev:screenshot`, crops, encodes to .webp, and
 * writes to `docs/public/images/`.
 *
 * Spec: [[Agent Console Screenshot Automation]] § Architecture Impact.
 * Test contract: tools/screenshots/lib/__tests__/manifest.test.ts.
 *
 * Decision: validation is shape-level only. Whether a crop region fits
 * inside the captured image is a runtime concern (capture is upstream of
 * crop). The validator's job is to catch authoring mistakes before
 * launching Obsidian (T04 in the spec).
 */
import { existsSync } from "node:fs";
import path from "node:path";

/** Pixel rectangle in the source-screenshot coordinate space. */
export interface CropRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** One screenshot specification. */
export interface ManifestEntry {
	/** Unique identifier within the manifest; used as CLI selector. */
	name: string;
	/**
	 * Output path relative to `docs/public/images/`.
	 * Convention: `<name>.webp`.
	 */
	output: string;
	/** Final image width in pixels (after crop, before .webp encoding). */
	width: number;
	/** Final image height in pixels. */
	height: number;
	/** Crop region in the captured screenshot's coordinate space. */
	crop: CropRect;
	/**
	 * Optional path to a prompt fixture file (relative to
	 * `tools/screenshots/fixtures/prompts/`). When set, the driver sends
	 * the file's contents as the user message in the active session before
	 * capturing.
	 */
	promptFile?: string;
	/**
	 * When true, the driver toggles `obsidian dev:mobile on` before
	 * capturing this entry and back off after. Reserved for F01.
	 */
	mobile?: boolean;
}

export interface Manifest {
	entries: ManifestEntry[];
}

/**
 * Parse a manifest from a JSON string. Throws on syntax errors or
 * structural mismatches (e.g. `entries` missing or non-array). Does NOT
 * check fixture file existence — that's `validateManifest`.
 */
export function parseManifest(json: string): Manifest {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`manifest is not valid JSON: ${msg}`);
	}
	if (typeof raw !== "object" || raw === null) {
		throw new Error("manifest must be a JSON object");
	}
	const obj = raw as Record<string, unknown>;
	if (!("entries" in obj)) {
		throw new Error("manifest missing required field: entries");
	}
	if (!Array.isArray(obj.entries)) {
		throw new Error("manifest field entries must be an array");
	}
	// Shape-cast; per-entry validation lives in validateManifest.
	return { entries: obj.entries as ManifestEntry[] };
}

/**
 * Validate a parsed manifest against on-disk fixtures.
 *
 * @param manifest - parsed manifest
 * @param fixtureRoot - directory containing `vault/` and `prompts/`
 *   subdirectories (typically `tools/screenshots/fixtures/`)
 *
 * Throws on the first failure. Failures include:
 * - empty or duplicate `name`
 * - non-positive `width` or `height`
 * - `promptFile` references a file that doesn't exist under
 *   `<fixtureRoot>/prompts/`
 *
 * Notes:
 * - Crop region is NOT validated against (width, height) — they live in
 *   different coordinate spaces. See manifest.test.ts pin.
 * - Output path collisions are caller's responsibility (the driver writes
 *   to `docs/public/images/`; collisions are version-controlled).
 */
export function validateManifest(
	manifest: Manifest,
	fixtureRoot: string,
): void {
	const seen = new Set<string>();
	for (const entry of manifest.entries) {
		if (!entry.name || entry.name.trim() === "") {
			throw new Error(`manifest entry has empty name`);
		}
		if (seen.has(entry.name)) {
			throw new Error(`manifest has duplicate name: ${entry.name}`);
		}
		seen.add(entry.name);

		if (!Number.isFinite(entry.width) || entry.width <= 0) {
			throw new Error(
				`manifest entry "${entry.name}" has invalid width: ${entry.width}`,
			);
		}
		if (!Number.isFinite(entry.height) || entry.height <= 0) {
			throw new Error(
				`manifest entry "${entry.name}" has invalid height: ${entry.height}`,
			);
		}

		if (entry.promptFile) {
			const promptPath = path.join(
				fixtureRoot,
				"prompts",
				entry.promptFile,
			);
			if (!existsSync(promptPath)) {
				throw new Error(
					`manifest entry "${entry.name}" references missing prompt file: ${entry.promptFile} (looked under ${path.join(fixtureRoot, "prompts")})`,
				);
			}
		}
	}
}
