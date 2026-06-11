/**
 * Animated-GIF encoder (v2).
 *
 * The still pipeline crops one window capture to a .webp. The animation
 * pipeline captures one cropped PNG per logical frame (driven deterministically
 * by the orchestrator), then this module encodes the ordered frames into a
 * looping .gif via a two-pass ffmpeg palettegen/paletteuse run.
 *
 * Why ffmpeg palettegen/paletteuse: a GIF is limited to 256 colors, so a naive
 * single-pass encode of a UI screenshot bands badly. palettegen builds an
 * optimized palette from the whole frame sequence; paletteuse maps each frame
 * to it with dithering. ffmpeg is already on the maintainer's box (8.x); gifski
 * (per-frame palettes, marginally better) is NOT installed, so it stays an
 * optional future upgrade rather than a hard dependency.
 *
 * Per-frame HOLD is realized at a CONSTANT encode fps by repeating each logical
 * frame `round(holdMs/1000 * fps)` times (`expandFrames`). A constant-framerate
 * input is the most portable ffmpeg path (variable per-frame delays via the
 * concat demuxer are fiddly and less reproducible). These are stepped UI
 * transitions, not smooth video, so a low fps with held states reads correctly
 * and keeps the file tiny.
 *
 * All process/fs side effects are injected (`EncodeGifDeps`) so the pure arg
 * builders + frame-expansion math are unit-testable without spawning ffmpeg.
 *
 * Spec: [[Agent Console Screenshot Automation]] § Stages (v2).
 * Test contract: tools/screenshots/lib/__tests__/encode-gif.test.ts.
 */
import path from "node:path";

/** One captured logical frame plus how long to hold it in the GIF. */
export interface AnimationFrameInput {
	/** Cropped, target-sized PNG bytes for this frame. */
	buffer: Buffer;
	/** How long this state is shown in the GIF, ms. */
	holdMs: number;
}

/**
 * Realize per-frame hold at a constant fps by repeating each logical frame
 * `round(holdMs/1000 * fps)` times (minimum 1, so a frame never vanishes). The
 * returned array is the constant-framerate sequence ffmpeg consumes.
 *
 * @throws when `fps <= 0` or `frames` is empty.
 */
export function expandFrames(
	frames: AnimationFrameInput[],
	fps: number,
): Buffer[] {
	if (!Number.isFinite(fps) || fps <= 0) {
		throw new Error(`encodeGif: fps must be a finite number > 0, got ${fps}`);
	}
	if (frames.length === 0) {
		throw new Error("encodeGif: no frames to encode");
	}
	const out: Buffer[] = [];
	for (const f of frames) {
		if (!Number.isFinite(f.holdMs) || f.holdMs <= 0) {
			throw new Error(
				`encodeGif: frame holdMs must be a finite number > 0, got ${f.holdMs}`,
			);
		}
		const reps = Math.max(1, Math.round((f.holdMs / 1000) * fps));
		for (let i = 0; i < reps; i++) out.push(f.buffer);
	}
	return out;
}

/** Zero-padded frame filename (`frame-00000.png`) matching the ffmpeg `%05d` pattern. */
export function frameFileName(index: number): string {
	return `frame-${String(index).padStart(5, "0")}.png`;
}

/** The ffmpeg input pattern for a work dir of `frame-%05d.png` files. */
export function framePattern(dir: string): string {
	return path.join(dir, "frame-%05d.png");
}

/**
 * ffmpeg args for pass 1 — build an optimized 256-color palette from the
 * whole frame sequence (`stats_mode=diff` weights moving regions, which is
 * what a UI transition GIF is all about).
 */
export function buildPaletteGenArgs(
	pattern: string,
	palettePath: string,
	fps: number,
): string[] {
	return [
		"-y",
		"-framerate",
		String(fps),
		"-i",
		pattern,
		"-vf",
		"palettegen=stats_mode=diff",
		palettePath,
	];
}

/**
 * ffmpeg args for pass 2 — encode the looping GIF using the generated palette.
 * `paletteuse` with light Bayer dithering avoids flat-color banding; `-loop 0`
 * loops forever (the docs GIFs should replay).
 */
export function buildPaletteUseArgs(
	pattern: string,
	palettePath: string,
	outPath: string,
	fps: number,
): string[] {
	return [
		"-y",
		"-framerate",
		String(fps),
		"-i",
		pattern,
		"-i",
		palettePath,
		"-lavfi",
		"paletteuse=dither=bayer:bayer_scale=3",
		"-loop",
		"0",
		outPath,
	];
}

/** Injected side effects, mocked in tests. */
export interface EncodeGifDeps {
	/** Create a fresh temp working directory and return its absolute path. */
	makeWorkDir: () => string;
	/** Write a frame PNG (named via {@link frameFileName}) into `dir`. */
	writeFrame: (dir: string, index: number, buffer: Buffer) => void;
	/** Run ffmpeg with the given args; reject on non-zero exit. */
	runFfmpeg: (args: string[]) => Promise<void>;
	/** Byte size of a written file. */
	statBytes: (path: string) => number;
}

export interface EncodeGifOptions {
	frames: AnimationFrameInput[];
	fps: number;
	outPath: string;
	/** Hard ceiling — encode fails if the output exceeds this many bytes. */
	maxBytes: number;
}

export interface EncodeGifResult {
	/** Number of constant-fps frames actually encoded (post-expansion). */
	frameCount: number;
	/** Final GIF size in bytes. */
	bytes: number;
}

/**
 * Encode the ordered frames to a looping GIF and assert the result.
 *
 * Asserts (fail-loud, the I12 precedent applied to animation):
 * - at least one frame (via `expandFrames`)
 * - the output exists and is within `maxBytes` (docs file-size ceiling)
 *
 * @throws when the encode produces no usable output or exceeds `maxBytes`.
 */
export async function encodeGif(
	opts: EncodeGifOptions,
	deps: EncodeGifDeps,
): Promise<EncodeGifResult> {
	const expanded = expandFrames(opts.frames, opts.fps);
	const dir = deps.makeWorkDir();
	expanded.forEach((buf, i) => deps.writeFrame(dir, i, buf));
	const pattern = framePattern(dir);
	const palettePath = path.join(dir, "palette.png");
	await deps.runFfmpeg(buildPaletteGenArgs(pattern, palettePath, opts.fps));
	await deps.runFfmpeg(
		buildPaletteUseArgs(pattern, palettePath, opts.outPath, opts.fps),
	);
	const bytes = deps.statBytes(opts.outPath);
	if (!Number.isFinite(bytes) || bytes <= 0) {
		throw new Error(
			`encodeGif: output ${opts.outPath} is missing or empty (${bytes} bytes)`,
		);
	}
	if (bytes > opts.maxBytes) {
		throw new Error(
			`encodeGif: ${opts.outPath} is ${bytes} bytes, exceeds the ${opts.maxBytes}-byte ceiling — shorten the animation, drop fps, or shrink the crop`,
		);
	}
	return { frameCount: expanded.length, bytes };
}
