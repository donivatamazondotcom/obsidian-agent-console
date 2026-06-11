/**
 * Drop-shadow post-processing for screenshots.
 *
 * Composites the screenshot onto a larger transparent canvas over a
 * blurred dark shape, giving docs images depth. Writes to a temp file
 * and renames over the original — sharp produces a no-op when its
 * `.toFile()` target is the same path it sourced from.
 *
 * Test contract: tools/screenshots/lib/__tests__/shadow.test.ts.
 */
import { renameSync } from "node:fs";
import sharp from "sharp";

export interface ShadowOptions {
	/** Transparent margin (px) added on every side for the shadow to spread. */
	margin?: number;
	/** Gaussian blur sigma for the shadow edge. */
	blur?: number;
	/** Shadow opacity (0–1). */
	opacity?: number;
	/** Vertical offset (px) of the shadow below the image. */
	offsetY?: number;
}

/** Add a soft drop shadow to an image file, overwriting it in place. */
export async function addDropShadow(
	filePath: string,
	opts: ShadowOptions = {},
): Promise<void> {
	const { margin = 40, blur = 16, opacity = 0.45, offsetY = 12 } = opts;

	const { width, height } = await sharp(filePath).metadata();
	if (!width || !height) {
		throw new Error(`addDropShadow: cannot read dimensions of ${filePath}`);
	}
	const screenshot = await sharp(filePath).toBuffer();
	const canvasW = width + margin * 2;
	const canvasH = height + margin * 2;

	// A solid dark rectangle the size of the screenshot...
	const rect = await sharp({
		create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: opacity } },
	})
		.png()
		.toBuffer();

	// ...placed (offset down) on a transparent canvas and blurred, so its
	// edges feather into transparency — that feathering is the shadow.
	const shadow = await sharp({
		create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
	})
		.composite([{ input: rect, left: margin, top: margin + offsetY }])
		.blur(blur)
		.png()
		.toBuffer();

	// Composite shadow then screenshot onto the final transparent canvas.
	const tmpOut = `${filePath}.shadow.tmp`;
	await sharp({
		create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
	})
		.composite([
			{ input: shadow, left: 0, top: 0 },
			{ input: screenshot, left: margin, top: margin },
		])
		.webp({ quality: 90 })
		.toFile(tmpOut);
	renameSync(tmpOut, filePath);
}
