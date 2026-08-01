#!/usr/bin/env npx tsx
/**
 * Screenshot consistency check CLI (v3).
 *
 * Static gate — no Obsidian, no agents, no Xvfb. Verifies that the manifest,
 * the committed docs images, and the docs references stay in sync, and that
 * animation gifs match their manifest dimensions. Exits non-zero on any drift
 * so CI can block the PR. See lib/check.ts for the (pure, tested) logic.
 *
 * Usage: npm run docs:screenshots:check
 *
 * Spec: [[Agent Console Screenshot Automation]] § Stages (v3).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { log, logError } from "../lib/cli-log";
import { parseManifest, validateManifest } from "./lib/manifest";
import {
	checkConsistency,
	findGifDimMismatches,
	findDocEmbedGaps,
	formatProblems,
	formatDocEmbedGaps,
	derivedImageName,
	pendingEntryNames,
} from "./lib/check";

const IMAGE_EXT = /\.(webp|gif)$/;
const IMAGE_REF = /images\/([A-Za-z0-9._-]+\.(?:webp|gif))/g;

/** Recursively collect *.md files under a dir, skipping the vitepress build output. */
function collectMarkdown(dir: string, acc: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (name === "dist" || name === "node_modules") continue;
		const full = path.join(dir, name);
		const st = statSync(full);
		if (st.isDirectory()) collectMarkdown(full, acc);
		else if (name.endsWith(".md")) acc.push(full);
	}
	return acc;
}

/**
 * Image references via `images/<name>.<ext>` across docs + README.
 *
 * Returns both the flat set (for {@link checkConsistency}) and the per-page
 * breakdown keyed by repo-relative POSIX path plus the list of pages scanned
 * (for {@link findDocEmbedGaps}, which must know WHICH page embeds what to
 * judge an entry's `docPage`).
 */
function collectDocImageRefs(repoRoot: string): {
	refs: string[];
	refsByPage: Record<string, string[]>;
	docPages: string[];
} {
	const files = collectMarkdown(path.join(repoRoot, "docs"));
	const readme = path.join(repoRoot, "README.md");
	try {
		statSync(readme);
		files.push(readme);
	} catch {
		/* no README */
	}
	const refs = new Set<string>();
	const refsByPage: Record<string, string[]> = {};
	const docPages: string[] = [];
	for (const f of files) {
		const text = readFileSync(f, "utf-8");
		// Manifest docPage values are repo-relative POSIX paths; normalize so
		// the comparison holds on Windows too.
		const rel = path.relative(repoRoot, f).split(path.sep).join("/");
		docPages.push(rel);
		const perPage = new Set<string>();
		for (const m of text.matchAll(IMAGE_REF)) {
			refs.add(m[1]);
			perPage.add(m[1]);
		}
		refsByPage[rel] = [...perPage];
	}
	return { refs: [...refs], refsByPage, docPages };
}

async function main() {
	const repoRoot = path.resolve(__dirname, "../..");
	const fixtureRoot = path.resolve(__dirname, "fixtures");
	const imagesDir = path.join(repoRoot, "docs", "public", "images");

	const manifest = parseManifest(
		readFileSync(path.join(__dirname, "manifest.json"), "utf-8"),
	);
	validateManifest(manifest, fixtureRoot);

	const presentImages = readdirSync(imagesDir).filter((f) => IMAGE_EXT.test(f));
	const { refs: docRefs, refsByPage, docPages } =
		collectDocImageRefs(repoRoot);

	const report = checkConsistency({
		entries: manifest.entries,
		presentImages,
		docRefs,
	});

	// Docs-embed gate: a committed image must actually be SHOWN on the page its
	// docPage claims. checkConsistency cannot see this class (its orphan rule
	// skips any image owning a manifest entry), so it is checked separately.
	const docEmbedGaps = findDocEmbedGaps({
		entries: manifest.entries,
		docPages,
		refsByPage,
		presentImages,
	});

	// Animation gifs: read actual dimensions for an exact match against manifest.
	const dims = new Map<string, { width: number; height: number }>();
	for (const e of manifest.entries) {
		if (!e.animation) continue;
		const name = derivedImageName(e);
		if (!presentImages.includes(name)) continue;
		const meta = await sharp(path.join(imagesDir, name)).metadata();
		dims.set(name, { width: meta.width ?? 0, height: meta.height ?? 0 });
	}
	const gifMismatches = findGifDimMismatches(manifest.entries, dims);

	const problems = [
		...formatProblems(report, gifMismatches),
		...formatDocEmbedGaps(docEmbedGaps),
	];
	if (problems.length > 0) {
		logError("❌ Screenshot consistency check failed:");
		for (const p of problems) logError(`  - ${p}`);
		process.exit(1);
	}

	// Release gate: `--strict` (wired to the `preversion` npm hook) refuses to
	// pass while any entry is still pending capture, so a tag can't ship a
	// feature whose docs screenshot is missing. Drop the `pending` flag and
	// commit the image (or remove the entry) to clear it.
	const strict = process.argv.includes("--strict");
	const pending = pendingEntryNames(manifest.entries);
	if (strict && pending.length > 0) {
		logError(
			`❌ Release gate: ${pending.length} screenshot(s) still pending capture — capture them (drop "pending" + commit the image) or remove the entry before tagging:`,
		);
		for (const n of pending) logError(`  - ${n}`);
		process.exit(1);
	}

	const pendingNote =
		pending.length > 0 ? ` (${pending.length} pending capture)` : "";
	log(
		`✅ Screenshot consistency OK — ${manifest.entries.length} manifest entries, ${presentImages.length} committed images, ${docRefs.length} docs references${pendingNote}.`,
	);
}

main().catch((err) => {
	logError(err);
	process.exit(1);
});
