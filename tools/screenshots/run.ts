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
import { addDropShadow } from "./lib/shadow";

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

	// Vault name for CDP targeting (the fixtures vault folder is named "vault")
	const vaultName = process.env.SCREENSHOT_VAULT || "vault";
	const cdp = new Cdp({ vault: vaultName });

	// Window sized to fit the tabs + active note + full chat transcript AND
	// the composer (showing its context-note pill + an example draft message).
	// Height covers the messages viewport (transcript ~539px) plus the composer
	// (~149px) and header chrome (~150px). The chat scroll container's ~120px bottom
	// padding harmlessly overflows behind the composer (scroll-to-bottom button
	// is hidden), so ~760px shows the full transcript + composer snugly. The drop shadow adds the
	// surrounding background. Was 1920x1200 — far too large.
	await cdp.setViewport(1400, 760);

	// Device pixel ratio: env override, else detect from the live window.
	// The capture PNG is in device pixels but getBoundingClientRect returns
	// CSS px; a wrong DPR makes the scaled crop overrun the image (sharp
	// "bad extract area"). Observed dpr=1 on this display, not the old 2.
	const dpr = process.env.SCREENSHOT_DPR
		? parseInt(process.env.SCREENSHOT_DPR, 10)
		: await cdp.evaluate<number>("window.devicePixelRatio");

	// Wire up real deps
	const sharp = (await import("sharp")).default;
	const deps: OrchestratorDeps = {
		cdp,
		sharp: (input: string) => sharp(input),
		repoRoot,
		fixtureRoot,
		tmpDir,
		readFile: (p, enc) => readFileSync(p, enc as BufferEncoding),
		devicePixelRatio: dpr,
		postProcess: (output) => addDropShadow(output),
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
