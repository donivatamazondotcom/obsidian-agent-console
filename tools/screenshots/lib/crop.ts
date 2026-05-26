/**
 * Crop region math for screenshot post-processing.
 *
 * Two coordinate systems collide here:
 * - CSS pixels (what `getBoundingClientRect()` returns): independent of
 *   display scaling. A 44-px-wide ribbon is "44 CSS px" regardless of
 *   retina.
 * - Device pixels (what `dev:screenshot` produces): includes the display
 *   scaling factor. On a 2x retina display, the same 44-px-wide ribbon is
 *   88 device px in the captured PNG.
 *
 * The driver passes the device-pixel rect to `sharp`'s extract() to crop.
 *
 * Spec: [[Agent Console Screenshot Automation]] § Architecture Impact.
 * Test contract: tools/screenshots/lib/__tests__/crop.test.ts.
 */

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ImageBounds {
	width: number;
	height: number;
}

export interface ComputeCropOptions {
	/** Pixels of padding to expand the crop on every side. Default 0. */
	padding?: number;
	/** Final image bounds; if set, clamp the crop to fit. */
	imageBounds?: ImageBounds;
}

/**
 * Convert a CSS-pixel rect to a device-pixel rect by multiplying by DPR.
 * Conservative rounding: floor x/y, ceil width/height, so the resulting
 * rect always covers at least the original CSS region.
 */
export function scaleRectByDevicePixelRatio(rect: Rect, dpr: number): Rect {
	if (!Number.isFinite(dpr) || dpr <= 0) {
		throw new Error(`devicePixelRatio must be > 0, got ${dpr}`);
	}
	const x = Math.floor(rect.x * dpr);
	const y = Math.floor(rect.y * dpr);
	const right = Math.ceil((rect.x + rect.width) * dpr);
	const bottom = Math.ceil((rect.y + rect.height) * dpr);
	return { x, y, width: right - x, height: bottom - y };
}

/**
 * Compute the final crop rect from an element bounds rect, optional
 * uniform padding, and optional image-bound clamping.
 */
export function computeCropRect(
	elementBounds: Rect,
	options: ComputeCropOptions = {},
): Rect {
	const padding = options.padding ?? 0;

	// Expand by padding on every side, then clamp x/y at 0. When clamping
	// occurs, width/height shrink by 2× the clamped amount — once because
	// we couldn't push the left edge further left, and once because the
	// total span we wanted (left padding + content + right padding) is
	// pinned by the right edge, which moved with the original element.
	// The crop ends up flush against x=0 with proportionally less width.
	const desiredX = elementBounds.x - padding;
	const desiredY = elementBounds.y - padding;
	const x = Math.max(0, desiredX);
	const y = Math.max(0, desiredY);
	const leftClamped = x - desiredX; // 0 when no clamping happened
	const topClamped = y - desiredY;
	let width = elementBounds.width + 2 * padding - 2 * leftClamped;
	let height = elementBounds.height + 2 * padding - 2 * topClamped;

	// Clamp at image bounds if provided.
	if (options.imageBounds) {
		const maxRight = options.imageBounds.width;
		const maxBottom = options.imageBounds.height;
		if (x + width > maxRight) width = maxRight - x;
		if (y + height > maxBottom) height = maxBottom - y;
	}

	return { x, y, width, height };
}
