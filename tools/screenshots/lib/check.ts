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
 * - no docs-embed gaps: an entry's committed image must actually be shown on
 *   the page its `docPage` claims (and any entry without a `docPage` must be
 *   referenced somewhere) — the class the orphan rule above cannot see, since
 *   that rule ignores any image owning a manifest entry (see findDocEmbedGaps);
 *   shadow and never resize, so this is deterministic — a chrome-framed GIF adds
 *   the synthetic-bar height, folded into the expected height below — unlike the
 *   webp shots, whose committed size depends on the shadow margin / cropSelector
 *   native size, left to the manual T05 check).
 *
 * Runs in CI on every PR; see `.github/workflows/ci.yaml`.
 *
 * Spec: [[Agent Console Screenshot Automation]] § Stages (v3).
 * Test contract: tools/screenshots/lib/__tests__/check.test.ts.
 */
import type { ManifestEntry } from "./manifest";
import { resolveFrameConfig } from "./frame";

/** Derived committed-image filename for an entry (gif for animation, else webp). */
export function derivedImageName(entry: ManifestEntry): string {
	return `${entry.name}.${entry.animation ? "gif" : "webp"}`;
}

/**
 * Names of entries flagged `pending` (a registered capture spec whose image
 * has not been committed yet), sorted. Day-to-day CI tolerates these; the
 * release gate (`check.ts --strict`, wired to the `preversion` npm hook)
 * treats a non-empty list as a hard failure so a version can't be tagged
 * while a shipped feature still lacks its docs screenshot.
 */
export function pendingEntryNames(entries: ManifestEntry[]): string[] {
	return entries
		.filter((e) => e.pending)
		.map((e) => e.name)
		.sort();
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
		// A chrome-framed GIF (option-c hero) is taller than its content by the
		// synthetic macOS bar the animation path stacks on each frame; the
		// manifest height stays the CONTENT height (as for still framed entries),
		// so fold the chrome in when computing the expected file height.
		const cfg = resolveFrameConfig(e);
		const chromeH = cfg?.chrome === "macos" ? cfg.chromeHeight : 0;
		const expectedHeight = e.height + chromeH;
		if (d.width !== e.width || d.height !== expectedHeight) {
			out.push({
				name,
				expected: { width: e.width, height: expectedHeight },
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

/**
 * A docs-embed gap: a manifest entry whose committed image is not actually
 * shown on the docs page it claims (or on any page at all).
 *
 * Why this is a separate check from {@link checkConsistency}: that function's
 * `orphans` rule is `!derived.has(p) && !refs.has(p)` — an AND. Any image with
 * a manifest entry satisfies `derived.has(p)`, so it is excluded from orphan
 * detection REGARDLESS of whether a docs page references it. The class "entry
 * exists + image committed + embedded nowhere" is therefore structurally
 * invisible to it, and `docPage` was never read at all. Both gaps shipped
 * undetected: `interactive-buttons` had a committed image and a real docs page
 * that embedded nothing, while `mcp-oauth-signin-notice` pointed at
 * "usage/mcp-tools" (no `docs/` prefix, no `.md`) — CI stayed green for both.
 */
export interface DocEmbedGap {
	/** Manifest entry name. */
	name: string;
	kind:
		| /** `docPage` is declared but no such file exists. */
		"missing-doc-page"
		| /** `docPage` exists but does not reference the entry's image. */
		"not-embedded-in-doc-page"
		| /** No `docPage`, and no docs page or README references the image. */
		"unreferenced-image";
	/** Human-readable specifics for the failure line. */
	detail: string;
}

export interface DocEmbedInput {
	entries: ManifestEntry[];
	/** Repo-relative POSIX paths of docs pages that exist on disk. */
	docPages: string[];
	/** Repo-relative page path -> image basenames that page references. */
	refsByPage: Record<string, string[]>;
	/** Committed image basenames in docs/public/images (webp + gif). */
	presentImages: string[];
}

/**
 * Find entries whose image is committed but not actually embedded where the
 * manifest says (or anywhere).
 *
 * At most ONE gap per entry, most specific first, so the output stays
 * actionable: an entry declaring a `docPage` is judged against that page only
 * (its non-embedding there is the actionable fact, and `unreferenced-image`
 * would be redundant); an entry with no `docPage` is judged against every page.
 *
 * `pending` entries are skipped — their image is not committed yet by design,
 * which is {@link pendingEntryNames}' concern, not this one.
 */
export function findDocEmbedGaps(input: DocEmbedInput): DocEmbedGap[] {
	const present = new Set(input.presentImages);
	const pages = new Set(input.docPages);
	const gaps: DocEmbedGap[] = [];

	// Every image referenced by any page, for the no-docPage case.
	const allRefs = new Set<string>();
	for (const refs of Object.values(input.refsByPage)) {
		for (const r of refs) allRefs.add(r);
	}

	for (const entry of input.entries) {
		if (entry.pending) continue;
		const image = derivedImageName(entry);
		// An uncommitted image is `missing`, reported by checkConsistency.
		if (!present.has(image)) continue;

		const declared = entry.docPage;
		if (declared !== undefined) {
			if (!pages.has(declared)) {
				gaps.push({
					name: entry.name,
					kind: "missing-doc-page",
					detail: `docPage "${declared}" does not exist (expected a repo-relative path like "docs/usage/<page>.md")`,
				});
				continue;
			}
			if (!(input.refsByPage[declared] ?? []).includes(image)) {
				const elsewhere = Object.entries(input.refsByPage)
					.filter(([, refs]) => refs.includes(image))
					.map(([page]) => page)
					.sort();
				const where =
					elsewhere.length > 0
						? `; it is embedded in ${elsewhere.join(", ")} — fix docPage or add the embed`
						: "";
				gaps.push({
					name: entry.name,
					kind: "not-embedded-in-doc-page",
					detail: `docPage "${declared}" does not embed ${image}${where}`,
				});
			}
			continue;
		}

		if (!allRefs.has(image)) {
			gaps.push({
				name: entry.name,
				kind: "unreferenced-image",
				detail: `${image} is committed but no docs page or README references it — embed it and set docPage, or remove the entry`,
			});
		}
	}

	return gaps.sort((a, b) => a.name.localeCompare(b.name));
}

/** Flatten docs-embed gaps into human-readable problem lines (empty = clean). */
export function formatDocEmbedGaps(gaps: DocEmbedGap[]): string[] {
	return gaps.map((g) => `docs-embed gap [${g.kind}] ${g.name}: ${g.detail}`);
}
