/**
 * Screenshot manifest schema, parser, and validator.
 *
 * The manifest is a JSON file at `tools/screenshots/manifest.json` listing
 * each screenshot the docs site needs. The driver reads it, drives a
 * separately-launched Obsidian instance through each entry's UI state,
 * captures via `obsidian dev:screenshot`, crops, encodes to .webp, and
 * writes to `docs/public/images/<name>.webp` (output path derived from
 * `name` via `lib/output.ts`).
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

/**
 * Declarative UI-state hints. The driver reads these and translates to
 * `obsidian dev:cdp Runtime.evaluate` calls (open the named note, click
 * the ribbon icon, open the floating chat view) before capturing. Kept
 * narrow on purpose: the v0 entries only need these three flags. Add new
 * fields here when a new entry needs a new UI affordance.
 */
export interface InitialState {
	/**
	 * Path of a fixture note to open in the active leaf. Resolved against
	 * `<fixtureRoot>/vault/`. Validated by `validateManifest`.
	 */
	openNote?: string;
	/**
	 * When true, click the Agent Console ribbon icon to activate the
	 * plugin's panel. Idempotent — clicking again with the panel already
	 * open is a no-op.
	 */
	clickRibbon?: boolean;
	/**
	 * When true, open the plugin's floating chat view via the dedicated
	 * command. Required for floating-chat-view.webp.
	 */
	openChatView?: boolean;
}

/** One screenshot specification. */
export interface ManifestEntry {
	/**
	 * Unique identifier within the manifest. Used as CLI selector
	 * (`npm run docs:screenshots -- <name>`) and as the output filename
	 * (`<name>.webp`) under `docs/public/images/`. Must be filesystem-
	 * and URL-safe.
	 */
	name: string;
	/** Final image width in pixels (after crop, before .webp encoding). */
	width: number;
	/** Final image height in pixels. */
	height: number;
	/** Crop region in the captured screenshot's coordinate space. */
	crop: CropRect;
	/**
	 * Optional CSS selector for auto-cropping. When set, the driver
	 * queries `getBoundingClientRect()` on this element at capture time
	 * and uses the result (plus `cropPadding`) as the crop region —
	 * overriding the static `crop` field. Falls back to `crop` if the
	 * selector matches nothing.
	 */
	cropSelector?: string;
	/**
	 * Padding in CSS pixels to add around the `cropSelector` bounds on
	 * all sides. Default 16. Ignored when `cropSelector` is not set.
	 */
	cropPadding?: number;
	/** Optional UI-state setup performed before capture. */
	initialState?: InitialState;
	/**
	 * Optional path to a prompt fixture file (relative to
	 * `tools/screenshots/fixtures/prompts/`). When set, the driver sends
	 * the file's contents as the user message in the active session
	 * before capturing.
	 */
	promptFile?: string;
	/**
	 * When true, the driver toggles `obsidian dev:mobile on` before
	 * capturing this entry and back off after. Reserved for F01.
	 */
	mobile?: boolean;
	/**
	 * Approval-test threshold for `pixelmatch` — fraction of differing
	 * pixels above which the test fails. Default 0.05 (loose enough for
	 * real-agent variability per Decision 2; tighten per-entry for
	 * deterministic UI like ribbon icons via e.g. `0.001`).
	 */
	approvalThreshold?: number;
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
 * - `initialState.openNote` references a file that doesn't exist under
 *   `<fixtureRoot>/vault/`
 * - `approvalThreshold` outside the `[0, 1]` range
 *
 * Notes:
 * - Crop region is NOT validated against (width, height) — they live in
 *   different coordinate spaces. See manifest.test.ts pin.
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

		if (entry.initialState?.openNote) {
			const notePath = path.join(
				fixtureRoot,
				"vault",
				entry.initialState.openNote,
			);
			if (!existsSync(notePath)) {
				throw new Error(
					`manifest entry "${entry.name}" references missing note: ${entry.initialState.openNote} (looked under ${path.join(fixtureRoot, "vault")})`,
				);
			}
		}

		if (entry.approvalThreshold !== undefined) {
			const t = entry.approvalThreshold;
			if (!Number.isFinite(t) || t < 0 || t > 1) {
				throw new Error(
					`manifest entry "${entry.name}" has invalid approvalThreshold: ${t} (must be in [0, 1])`,
				);
			}
		}
	}
}
