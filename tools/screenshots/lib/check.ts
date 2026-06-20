/**
 * Screenshot consistency check (v3) — pure logic.
 *
 * A static, environment-free gate for docs-image drift: it does NOT regenerate
 * screenshots (that needs a running Obsidian + real agents + Xvfb, and most
 * shots are non-deterministic by Decision 2, so a content-hash compare is
 * infeasible). Instead it checks the cheap, high-value invariants that catch
 * the common drift:
 *
 * - every manifest entry has a committed output image (gif for animation
 *   entries, webp otherwise);
 * - no orphan images (a committed image referenced by neither a manifest entry
 *   nor a docs page — e.g. a removed feature's leftover asset);
 * - no broken docs references (a docs page links an image that isn't on disk);
 * - animation gifs match their manifest dimensions exactly (gifs carry no drop
 *   shadow and never resize, so this is deterministic — unlike the webp shots,
 *   whose committed size depends on the shadow margin / cropSelector native
 *   size, left to the manual T05 check).
 *
 * Runs in CI on every PR; see `.github/workflows/ci.yaml`.
 *
 * Spec: [[Agent Console Screenshot Automation]] § Stages (v3).
 * Test contract: tools/screenshots/lib/__tests__/check.test.ts.
 */
import type { ManifestEntry } from "./manifest";

/** Derived committed-image filename for an entry (gif for animation, else webp). */
export function derivedImageName(entry: ManifestEntry): string {
	return `${entry.name}.${entry.animation ? "gif" : "webp"}`;
}

export interface ConsistencyInput {
	entries: ManifestEntry[];
	/** Image filenames present in docs/public/images (webp + gif only). */
	presentImages: string[];
	/** Image filenames (basename) referenced from docs pages + README. */
	docRefs: string[];
}

export interface ConsistencyReport {
	/** Entry-derived image names with no committed file. */
	missing: string[];
	/** Committed images claimed by neither a manifest entry nor a docs reference. */
	orphans: string[];
	/** Doc-referenced images that don't exist on disk. */
	brokenDocRefs: string[];
}

export function checkConsistency(input: ConsistencyInput): ConsistencyReport {
	const present = new Set(input.presentImages);
	const derived = new Set(input.entries.map(derivedImageName));
	const refs = new Set(input.docRefs);

	// Pending entries are registered capture specs whose image isn't captured
	// yet — exempt them from the missing-image rule. They still claim their
	// derived name (via `derived` above), so a later-committed image with that
	// name isn't mistaken for an orphan.
	const requiredDerived = input.entries
		.filter((e) => !e.pending)
		.map(derivedImageName);
	const missing = requiredDerived.filter((d) => !present.has(d)).sort();
	const orphans = input.presentImages
		.filter((p) => !derived.has(p) && !refs.has(p))
		.sort();
	const brokenDocRefs = [...refs].filter((r) => !present.has(r)).sort();

	return { missing, orphans, brokenDocRefs };
}

export interface GifDimMismatch {
	name: string;
	expected: { width: number; height: number };
	actual: { width: number; height: number };
}

/**
 * Animation entries only: the committed gif's dimensions must equal the
 * manifest's width/height (gifs carry no drop shadow and never resize). Entries
 * whose gif is absent are reported by {@link checkConsistency} (missing), not
 * here. `dims` is keyed by derived image name.
 */
export function findGifDimMismatches(
	entries: ManifestEntry[],
	dims: Map<string, { width: number; height: number }>,
): GifDimMismatch[] {
	const out: GifDimMismatch[] = [];
	for (const e of entries) {
		if (!e.animation) continue;
		const name = derivedImageName(e);
		const d = dims.get(name);
		if (!d) continue;
		if (d.width !== e.width || d.height !== e.height) {
			out.push({
				name,
				expected: { width: e.width, height: e.height },
				actual: { width: d.width, height: d.height },
			});
		}
	}
	return out;
}

/** Flatten a report + gif mismatches into human-readable problem lines (empty = clean). */
export function formatProblems(
	report: ConsistencyReport,
	gifMismatches: GifDimMismatch[],
): string[] {
	const problems: string[] = [];
	for (const m of report.missing) {
		problems.push(`missing committed image for manifest entry: ${m}`);
	}
	for (const o of report.orphans) {
		problems.push(
			`orphan image (no manifest entry, not referenced in docs): ${o}`,
		);
	}
	for (const b of report.brokenDocRefs) {
		problems.push(`docs reference a missing image: ${b}`);
	}
	for (const g of gifMismatches) {
		problems.push(
			`gif ${g.name} is ${g.actual.width}x${g.actual.height}, manifest expects ${g.expected.width}x${g.expected.height}`,
		);
	}
	return problems;
}
