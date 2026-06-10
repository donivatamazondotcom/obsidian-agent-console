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

/**
 * Bounding box that contains all input rects. Used for group crops where
 * several sibling elements (e.g. a cluster of header action icons) must be
 * framed together but no single wrapping element exists.
 *
 * @throws when `rects` is empty — an empty group has no meaningful box.
 */
export function unionRects(rects: Rect[]): Rect {
	if (rects.length === 0) {
		throw new Error("unionRects: empty rect list");
	}
	const left = Math.min(...rects.map((r) => r.x));
	const top = Math.min(...rects.map((r) => r.y));
	const right = Math.max(...rects.map((r) => r.x + r.width));
	const bottom = Math.max(...rects.map((r) => r.y + r.height));
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Compute symmetric `sharp.extend()` offsets that center a content box of
 * (contentWidth × contentHeight) inside a target box of
 * (targetWidth × targetHeight). Used to reproduce the upstream "icons
 * centered on the header background with generous padding" look when the
 * captured icons sit flush at the window edge (so surrounding pixels can't
 * be cropped — the padding is synthesized on a matching-color canvas).
 *
 * Odd remainders bias the extra pixel to the right/bottom. If content
 * meets or exceeds target on an axis, that axis's offsets are 0 — the
 * caller must guard (sharp.extend cannot shrink), see the orchestrator's
 * content-exceeds-target check.
 */
export function computeCenterExtend(
	contentWidth: number,
	contentHeight: number,
	targetWidth: number,
	targetHeight: number,
): { top: number; bottom: number; left: number; right: number } {
	const dw = Math.max(0, targetWidth - contentWidth);
	const dh = Math.max(0, targetHeight - contentHeight);
	const left = Math.floor(dw / 2);
	const right = dw - left;
	const top = Math.floor(dh / 2);
	const bottom = dh - top;
	return { top, bottom, left, right };
}

/**
 * True when two rects share any positive area. Strict overlap: edge-only
 * touching (one rect's right edge exactly at the other's left edge) does NOT
 * count — an element flush against the crop boundary with no area inside is
 * not "visible in" the crop. Used by the orchestrator's Tier-2 `mustShow`
 * assertion (rubric P2) to verify the delightful element falls inside the
 * crop region.
 */
export function rectIntersects(a: Rect, b: Rect): boolean {
	return (
		a.x < b.x + b.width &&
		b.x < a.x + a.width &&
		a.y < b.y + b.height &&
		b.y < a.y + a.height
	);
}
