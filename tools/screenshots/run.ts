#!/usr/bin/env npx tsx
/**
 * Screenshot automation CLI entry point.
 *
 * Usage:
 *   npm run docs:screenshots           # all entries
 *   npm run docs:screenshots -- <name>  # single entry
 *
 * Must be run from a regular Terminal.app (not from inside Agent Console's
 * kiro-cli session — the sandbox blocks process spawning).
 *
 * Spec: [[Agent Console Screenshot Automation]] § Architecture Impact.
 */
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseManifest, validateManifest } from "./lib/manifest";
import { captureAll, type OrchestratorDeps } from "./lib/orchestrator";
import { Cdp } from "./lib/cdp";

async function main() {
	const repoRoot = path.resolve(__dirname, "../..");
	const fixtureRoot = path.resolve(__dirname, "fixtures");
	const manifestPath = path.resolve(__dirname, "manifest.json");

	// Parse args: optional filter name
	const filter = process.argv[2] || undefined;

	// Read and validate manifest
	const manifestJson = readFileSync(manifestPath, "utf-8");
	const manifest = parseManifest(manifestJson);
	validateManifest(manifest, fixtureRoot);

	// Create temp dir for raw captures
	const tmpDir = mkdtempSync(path.join(tmpdir(), "screenshots-"));

	// Detect device pixel ratio (default 2 for retina Mac)
	const dpr = parseInt(process.env.SCREENSHOT_DPR || "2", 10);

	// Wire up real deps
	const sharp = (await import("sharp")).default;
	const deps: OrchestratorDeps = {
		cdp: new Cdp(),
		sharp: (input: string) => sharp(input),
		repoRoot,
		fixtureRoot,
		tmpDir,
		readFile: (p, enc) => readFileSync(p, enc as BufferEncoding),
		devicePixelRatio: dpr,
	};

	console.log(
		`📸 Capturing ${filter ? `"${filter}"` : `all ${manifest.entries.length} entries`}...`,
	);

	const results = await captureAll(manifest.entries, deps, { filter });

	// Report
	const failures = results.filter((r) => !r.success);
	for (const r of results) {
		const icon = r.success ? "✓" : "✗";
		const suffix = r.error ? ` — ${r.error}` : "";
		console.log(`  ${icon} ${r.name}${suffix}`);
	}

	if (failures.length > 0) {
		console.error(`\n❌ ${failures.length} screenshot(s) failed.`);
		process.exit(1);
	}
	console.log(`\n✅ Done. ${results.length} screenshot(s) written.`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
