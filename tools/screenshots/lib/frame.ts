/**
 * Presentation framing for screenshots (Decision 11).
 *
 * Mounts a captured shot in a polished frame: a diagonal gradient background +
 * a soft drop shadow + rounded corners + padding, plus (for full-window heroes)
 * a synthetic macOS title bar with traffic-light dots. Runs as the orchestrator
 * post-process step for entries that opt in via the manifest `frame` field,
 * REPLACING the flat drop shadow (`addDropShadow`) — the frame brings its own
 * shadow, so a framed entry skips the flat one. Because of that, `frameImage`
 * receives the CLEAN cropped image (no baked shadow margin); it does not trim.
 *
 * Framing intensity scales with `placement`:
 *   - hero    → full framed window: synthetic chrome + soft shadow + gradient
 *   - feature → chrome-less card:   rounded + soft shadow + gradient
 *   - reference → (unframed by default — these entries don't set `frame`)
 *
 * The soft shadow is a low-opacity black rounded rect drawn INSET on a
 * full-canvas transparent layer, then heavily blurred — so the blur has
 * transparent room to diffuse into. Blurring a buffer-FILLING opaque rect
 * produces a black slab, not a shadow (the prototype's first bug).
 *
 * Direct-`sharp` module (mirrors lib/shadow.ts), not injected deps: sharp is
 * pure/fast and safe to run in tests on small generated images. Pure SVG
 * builders + resolveFrameConfig are unit-tested directly.
 *
 * Spec: [[Agent Console Screenshot Automation]] § Decisions (11) +
 * [[Agent Console Screenshot Framing — research synthesis]].
 * Test contract: tools/screenshots/lib/__tests__/frame.test.ts.
 */
import { renameSync } from "node:fs";
import sharp from "sharp";
import type { ManifestEntry } from "./manifest";

/** A diagonal (top-left → bottom-right) two-stop gradient background. */
export interface FrameBackground {
	from: string;
	to: string;
}

/** Soft drop-shadow parameters. */
export interface FrameShadow {
	/** Shadow opacity (0–1). */
	opacity: number;
	/** Gaussian blur sigma — must be large relative to the window so the edge feathers. */
	blur: number;
	/** Vertical offset (px) of the shadow below the window. */
	offsetY: number;
}

/** Fully-resolved framing options (after placement defaults + overrides). */
export interface FrameOptions {
	/** "macos" adds a synthetic title bar with traffic lights (full-window heroes); "none" = chrome-less card. */
	chrome: "macos" | "none";
	background: FrameBackground;
	/** Corner radius (px) of the window/card. */
	cornerRadius: number;
	/** Matte padding (px) on every side between the window and the background edge. */
	padding: number;
	/** Synthetic chrome bar height (px); ignored when chrome === "none". */
	chromeHeight: number;
	shadow: FrameShadow;
}

/** Background corner radius of the gradient matte (transparent outside → rounded matte). */
const BG_RADIUS = 32;

/**
 * Validated defaults (2026-06-29 prototype, eyeballed). Tuned for a retina
 * full-window hero (~2800px wide) and a ~1300px crop respectively; for an
 * other-sized framed entry, tune `padding`/`shadow.blur` per-entry via the
 * manifest `frame` object.
 */
const HERO_DEFAULTS: FrameOptions = {
	chrome: "macos",
	// Fork palette (blue → cyan) — deliberately NOT upstream's purple/orange.
	background: { from: "#1d4ed8", to: "#06b6d4" },
	cornerRadius: 22,
	// Slim matte so the window fills the frame (maximizes visible UI); shadow
	// trimmed to fit within the 60px padding.
	padding: 60,
	chromeHeight: 54,
	shadow: { opacity: 0.4, blur: 30, offsetY: 16 },
};
const CARD_DEFAULTS: FrameOptions = {
	chrome: "none",
	// Fork palette (blue → cyan) — same cohesive gradient as the hero, NOT upstream.
	background: { from: "#1d4ed8", to: "#06b6d4" },
	cornerRadius: 16,
	padding: 60,
	chromeHeight: 0,
	shadow: { opacity: 0.4, blur: 30, offsetY: 16 },
};

/** Per-entry `frame` field: `true` for placement defaults, or an object to override. */
export type FrameSpec =
	| boolean
	| {
			chrome?: "macos" | "none";
			background?: Partial<FrameBackground>;
			cornerRadius?: number;
			padding?: number;
			chromeHeight?: number;
			shadow?: Partial<FrameShadow>;
	  };

/**
 * Resolve an entry's framing config, or `null` when the entry doesn't opt in.
 * `frame: true` uses placement-appropriate defaults (hero → framed window;
 * everything else → chrome-less card); `frame: {…}` overrides specific fields.
 * Pure — unit-tested.
 */
export function resolveFrameConfig(entry: ManifestEntry): FrameOptions | null {
	if (!entry.frame) return null;
	const base = entry.placement === "hero" ? HERO_DEFAULTS : CARD_DEFAULTS;
	const o = typeof entry.frame === "object" ? entry.frame : {};
	return {
		chrome: o.chrome ?? base.chrome,
		background: { ...base.background, ...(o.background ?? {}) },
		cornerRadius: o.cornerRadius ?? base.cornerRadius,
		padding: o.padding ?? base.padding,
		chromeHeight: o.chromeHeight ?? base.chromeHeight,
		shadow: { ...base.shadow, ...(o.shadow ?? {}) },
	};
}

// ── Pure SVG builders (exported for unit tests) ──────────────────────────────

/** Diagonal two-stop linear gradient with rounded matte corners. */
export function gradientSvg(w: number, h: number, bg: FrameBackground): string {
	return (
		`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><defs>` +
		`<linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">` +
		`<stop offset="0%" stop-color="${bg.from}"/>` +
		`<stop offset="100%" stop-color="${bg.to}"/>` +
		`</linearGradient></defs>` +
		`<rect width="${w}" height="${h}" rx="${BG_RADIUS}" fill="url(#g)"/></svg>`
	);
}

/** White rounded rect — composited `dest-in` to round the window's corners. */
export function roundedRectMaskSvg(w: number, h: number, r: number): string {
	return (
		`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
		`<rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`
	);
}

/** Synthetic macOS title bar: dark bar + three traffic-light dots. */
export function chromeBarSvg(w: number, h: number): string {
	return (
		`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
		`<rect width="${w}" height="${h}" fill="#2c2c2e"/>` +
		`<circle cx="${h * 0.62}" cy="${h / 2}" r="${h * 0.16}" fill="#ff5f56"/>` +
		`<circle cx="${h * 1.22}" cy="${h / 2}" r="${h * 0.16}" fill="#ffbd2e"/>` +
		`<circle cx="${h * 1.82}" cy="${h / 2}" r="${h * 0.16}" fill="#27c93f"/></svg>`
	);
}

/**
 * Shadow layer: a low-opacity black rounded rect drawn INSET (at the window's
 * position, offset down) on a full-canvas transparent layer — so a subsequent
 * heavy blur feathers softly on all sides instead of producing a black slab.
 */
export function shadowLayerSvg(
	canvasW: number,
	canvasH: number,
	winW: number,
	winH: number,
	pad: number,
	offsetY: number,
	radius: number,
	opacity: number,
): string {
	return (
		`<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">` +
		`<rect x="${pad}" y="${pad + offsetY}" width="${winW}" height="${winH}" ` +
		`rx="${radius}" fill="#000" fill-opacity="${opacity}"/></svg>`
	);
}

// ── Compositor ───────────────────────────────────────────────────────────────

/**
 * Frame an image file in place: optional synthetic chrome → round corners →
 * soft shadow → center on a gradient matte with padding. Overwrites `filePath`
 * (writes a temp file then renames, since sharp can't read+write the same path).
 * Assumes a CLEAN input (no baked drop-shadow margin) — framed entries skip
 * `addDropShadow`.
 */
export async function frameImage(
	filePath: string,
	opts: FrameOptions,
): Promise<void> {
	const { width: cw, height: ch } = await sharp(filePath).metadata();
	if (!cw || !ch) {
		throw new Error(`frameImage: cannot read dimensions of ${filePath}`);
	}
	const content = await sharp(filePath).toBuffer();

	// 1. Optional synthetic macOS chrome stacked above the content.
	const winW = cw;
	let winH = ch;
	let winBuf = content;
	if (opts.chrome === "macos") {
		winH = ch + opts.chromeHeight;
		winBuf = await sharp({
			create: {
				width: cw,
				height: winH,
				channels: 4,
				background: { r: 0, g: 0, b: 0, alpha: 0 },
			},
		})
			.composite([
				{
					input: Buffer.from(chromeBarSvg(cw, opts.chromeHeight)),
					top: 0,
					left: 0,
				},
				{ input: content, top: opts.chromeHeight, left: 0 },
			])
			.png()
			.toBuffer();
	}

	// 2. Round all corners via a dest-in mask.
	const rounded = await sharp(winBuf)
		.composite([
			{
				input: Buffer.from(
					roundedRectMaskSvg(winW, winH, opts.cornerRadius),
				),
				blend: "dest-in",
			},
		])
		.png()
		.toBuffer();

	// 3. Soft shadow (inset rect on a full-canvas transparent layer, then blur).
	const W = winW + opts.padding * 2;
	const H = winH + opts.padding * 2;
	const shadow = await sharp(
		Buffer.from(
			shadowLayerSvg(
				W,
				H,
				winW,
				winH,
				opts.padding,
				opts.shadow.offsetY,
				opts.cornerRadius,
				opts.shadow.opacity,
			),
		),
	)
		.blur(opts.shadow.blur)
		.png()
		.toBuffer();

	// 4. Composite shadow + window onto the gradient matte.
	const tmpOut = `${filePath}.frame.tmp`;
	await sharp(Buffer.from(gradientSvg(W, H, opts.background)))
		.composite([
			{ input: shadow, top: 0, left: 0 },
			{ input: rounded, top: opts.padding, left: opts.padding },
		])
		.webp({ quality: 90 })
		.toFile(tmpOut);
	renameSync(tmpOut, filePath);
}

/** Options for the animation-GIF chrome frame (no gradient matte / shadow). */
export interface ChromeFrameOptions {
	/** Synthetic macOS title-bar height in px, stacked above the content. */
	chromeHeight: number;
}

/**
 * Frame a single animation FRAME (buffer in → buffer out) with a synthetic
 * macOS title bar stacked above the content — option (c) of the hero-GIF
 * framing decision. Unlike `frameImage`, this deliberately adds NO gradient
 * matte, NO soft shadow, and NO padding: the GIF encoder collapses to a 256-
 * color palette, so a diagonal gradient background dithers badly and inflates
 * the file. The chrome bar (dark strip + traffic-light dots) alone gives the
 * "app window" read while keeping every frame's palette tight and identical
 * (only the inner content differs across frames). Corners stay square and the
 * output is fully opaque, so there are no 1-bit-transparency artifacts in the
 * GIF. Width is unchanged; height grows by `chromeHeight`.
 */
export async function chromeOnlyFrame(
	content: Buffer,
	opts: ChromeFrameOptions,
): Promise<Buffer> {
	const { width, height } = await sharp(content).metadata();
	if (!width || !height) {
		throw new Error("chromeOnlyFrame: cannot read content dimensions");
	}
	return await sharp({
		create: {
			width,
			height: height + opts.chromeHeight,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 1 },
		},
	})
		.composite([
			{
				input: Buffer.from(chromeBarSvg(width, opts.chromeHeight)),
				top: 0,
				left: 0,
			},
			{ input: content, top: opts.chromeHeight, left: 0 },
		])
		.png()
		.toBuffer();
}
