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
import {
	readFileSync,
	mkdtempSync,
	unlinkSync,
	writeFileSync,
	statSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseManifest, validateManifest } from "./lib/manifest";
import { captureAll, type OrchestratorDeps } from "./lib/orchestrator";
import { Cdp } from "./lib/cdp";
import { addDropShadow } from "./lib/shadow";
import { encodeGif, frameFileName } from "./lib/encode-gif";

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
	// Clear any stale device-metrics override left in the running Obsidian by a
	// prior run — it survives setup.sh's plugin reload and persists across
	// separate invocations. Without this, the previous run's
	// deviceScaleFactor:1 override pins window.devicePixelRatio to 1 here, so we
	// detect the wrong DPR and capture at half resolution on a retina display,
	// dropping fine detail like tooltip text (I11).
	await cdp.clearViewport();

	// Device pixel ratio: env override, else detect the REAL value from the live
	// window (now that the stale override is cleared). The capture PNG is in
	// device pixels but getBoundingClientRect returns CSS px; the crop is scaled
	// by this DPR, which MUST match the viewport's deviceScaleFactor below.
	const dpr = process.env.SCREENSHOT_DPR
		? parseInt(process.env.SCREENSHOT_DPR, 10)
		: await cdp.evaluate<number>("window.devicePixelRatio");

	// Apply the capture viewport at the REAL device scale factor. Forcing
	// deviceScaleFactor:1 on a dpr=2 display halved the captured resolution and
	// dropped fine detail (I11); the crop region (CSS px) is unchanged, only
	// fidelity improves. Must be set AFTER DPR detection (setting it first with
	// deviceScaleFactor:1 was the bug — it pinned the detected DPR to 1).
	await cdp.setViewport(1400, 760, dpr);

	// Wire up real deps
	const sharp = (await import("sharp")).default;
	const deps: OrchestratorDeps = {
		cdp,
		sharp: (input: string | Buffer) => sharp(input),
		repoRoot,
		fixtureRoot,
		tmpDir,
		readFile: (p, enc) => readFileSync(p, enc as BufferEncoding),
		devicePixelRatio: dpr,
		postProcess: (output) => addDropShadow(output),
		// Content guard: decode the final webp to raw RGB(A) pixels so the
		// orchestrator can count distinct colors and reject blank/degraded
		// captures (I11 follow-up). Read after postProcess (the shadow margin
		// collapses to a single color, matching the committed-file calibration).
		loadRaw: async (p) => {
			const { data, info } = (await sharp(p)
				.raw()
				.toBuffer({ resolveWithObject: true })) as {
				data: Buffer;
				info: { channels: number };
			};
			return { data, channels: info.channels };
		},
		unlink: (p) => unlinkSync(p),
		// v2 animation path: encode cropped PNG frames into a looping GIF via
		// ffmpeg (palettegen/paletteuse). Frames are written to a temp dir, two
		// ffmpeg passes run, and the output size is asserted against maxBytes.
		encodeGif: (opts) =>
			encodeGif(opts, {
				makeWorkDir: () => mkdtempSync(path.join(tmpdir(), "gif-frames-")),
				writeFrame: (dir, index, buffer) =>
					writeFileSync(path.join(dir, frameFileName(index)), buffer),
				runFfmpeg: (args) =>
					new Promise<void>((resolve, reject) => {
						const proc = spawn("ffmpeg", args, { stdio: "ignore" });
						proc.on("close", (code) =>
							code === 0
								? resolve()
								: reject(new Error(`ffmpeg exited with code ${code}`)),
						);
						proc.on("error", reject);
					}),
				statBytes: (p) => statSync(p).size,
			}),
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
