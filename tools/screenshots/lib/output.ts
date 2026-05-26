/**
 * Output path derivation for screenshots.
 *
 * Final paths live under `<repoRoot>/docs/public/images/`, matching
 * existing repo convention (Decision 5 in the spec). This module enforces
 * that boundary: entry.output paths must be relative and must not escape
 * the docs/public/images directory via traversal.
 *
 * Test contract: tools/screenshots/lib/__tests__/output.test.ts.
 */
import path from "node:path";

interface OutputEntry {
	output: string;
}

const DOCS_IMAGES_REL = path.join("docs", "public", "images");

/**
 * Derive the absolute output path for a manifest entry.
 *
 * @throws when entry.output is absolute or contains path traversal that
 *   escapes the docs/public/images directory.
 */
export function deriveOutputPath(entry: OutputEntry, repoRoot: string): string {
	if (path.isAbsolute(entry.output)) {
		throw new Error(
			`output path must be relative to docs/public/images, got absolute: ${entry.output}`,
		);
	}

	const baseDir = path.join(repoRoot, DOCS_IMAGES_REL);
	const resolved = path.resolve(baseDir, entry.output);

	// Ensure the resolved path stays inside baseDir. path.relative returns
	// either a path that starts with ".." or an absolute path when the
	// target escapes; both are traversal.
	const rel = path.relative(baseDir, resolved);
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new Error(
			`output path attempts traversal escape from docs/public/images: ${entry.output}`,
		);
	}

	return resolved;
}
