/**
 * Output path derivation for screenshots.
 *
 * Final paths live under `<repoRoot>/docs/public/images/`, matching
 * existing repo convention (Decision 5 in the spec). The output filename
 * is always `<name>.webp` — derived from the manifest entry's `name`
 * field. This module enforces:
 *
 * - The `name` is filesystem-safe (no path separators, no traversal
 *   sequences). Anything that could escape the docs/public/images
 *   directory is rejected before path construction.
 *
 * Spec: [[Agent Console Screenshot Automation]] § Architecture Impact.
 * Test contract: tools/screenshots/lib/__tests__/output.test.ts.
 */
import path from "node:path";

interface NameOnlyEntry {
	name: string;
}

const DOCS_IMAGES_REL = path.join("docs", "public", "images");

/**
 * Derive the absolute output path for a manifest entry.
 *
 * Output filename is `<entry.name>.webp` placed under
 * `<repoRoot>/docs/public/images/`. The entry's `name` must be
 * filesystem-safe — no separators, no traversal sequences, no absolute
 * paths.
 *
 * @throws when `entry.name` contains path separators, traversal
 *   sequences, or would otherwise escape the docs/public/images
 *   directory.
 */
export function deriveOutputPath(
	entry: NameOnlyEntry,
	repoRoot: string,
	ext = "webp",
): string {
	const name = entry.name;

	if (!name || name.trim() === "") {
		throw new Error("output: entry.name is empty");
	}
	if (path.isAbsolute(name)) {
		throw new Error(
			`output: entry.name must be a bare filename, got absolute path: ${name}`,
		);
	}
	// Reject any path-separator-bearing name. The manifest's name is the
	// entry's identifier AND its filename — keeping it bare is what makes
	// the schema unambiguous (Decision 7 follow-up).
	if (name.includes("/") || name.includes(path.sep)) {
		throw new Error(
			`output: entry.name must not contain path separators, got: ${name}`,
		);
	}
	if (name.includes("..")) {
		throw new Error(
			`output: entry.name must not contain traversal sequences, got: ${name}`,
		);
	}

	const baseDir = path.join(repoRoot, DOCS_IMAGES_REL);
	const filename = `${name}.${ext}`;
	return path.join(baseDir, filename);
}
