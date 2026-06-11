/**
 * Legibility floor for screenshot captures (rubric P5).
 *
 * Rubric P5 — "Legible at display size": a docs screenshot renders small in the
 * directory tile, README hero, and docs grid, so its focal element must read at
 * ~30–40% scale. The mechanical failure mode that destroys small-size legibility
 * is UPSCALING: when the cropped source region (in device pixels) is smaller than
 * the final emitted output dimensions, sharp's resize upscales — interpolating
 * pixels that were never captured — and the result blurs, then blurs again when
 * the docs site downscales it into a grid cell.
 *
 * This module computes the source→target scale factor and decides pass/fail
 * against a floor. The canonical floor is 1.0 (`DEFAULT_MIN_LEGIBILITY_SCALE`):
 * the source must be at least as large as the output, so the emit is a downscale
 * (sharp, retina-grade) and never an upscale (blur). A hero shot can tighten the
 * floor (e.g. 2.0 for true retina headroom) via the per-entry
 * `minLegibilityScale`; a plain reference shot could relax it below 1.0 if a
 * mild upscale is acceptable.
 *
 * Scope: this guard targets the RESIZE path only (static-crop entries, window and
 * screen mode), where an undersized source forces an upscale. `cropSelector`
 * entries emit at native captured size (no resize) and group `cropSelectors`
 * entries center-pad content that is already guarded to be <= target, so neither
 * upscales — the orchestrator skips the floor for them. The I11 retina-DPR work
 * is the complementary fidelity guard; this is the communicative-quality (P5) one.
 *
 * Spec: [[Agent Console Screenshot Automation]] § Decision 9 (Tier-2 asserts).
 * Test contract: tools/screenshots/lib/__tests__/legibility.test.ts.
 */

/**
 * Default minimum source/target scale. 1.0 = "no upscaling": the cropped source
 * region must be at least the output size, so the emit is always a downscale.
 */
export const DEFAULT_MIN_LEGIBILITY_SCALE = 1;

export interface LegibilityInput {
	/** Cropped source-region width in DEVICE pixels (what sharp extracts). */
	sourceWidth: number;
	/** Cropped source-region height in DEVICE pixels. */
	sourceHeight: number;
	/** Final emitted output width (what the docs site displays). */
	targetWidth: number;
	/** Final emitted output height. */
	targetHeight: number;
	/** Minimum acceptable scale; defaults to DEFAULT_MIN_LEGIBILITY_SCALE. */
	minScale?: number;
}

export interface LegibilityResult {
	/** True when `scale >= minScale` (inclusive — exactly at the floor passes). */
	ok: boolean;
	/** min(sourceW/targetW, sourceH/targetH) — the worst (most-upscaled) axis. */
	scale: number;
	/** The floor that was applied. */
	minScale: number;
	/** Which axis is the binding constraint on `scale`. */
	limitingAxis: "width" | "height";
}

/**
 * Compute the source→target scale and decide pass/fail against the floor.
 *
 * `scale` is the minimum of the per-axis ratios, so it reflects the axis that
 * would upscale the most. `scale >= minScale` passes (inclusive: a source that
 * exactly equals the target at the default floor of 1.0 passes — it's a 1:1
 * copy, not an upscale).
 *
 * @throws when any target dimension is <= 0 (no meaningful ratio) or a source
 *   dimension is negative.
 */
export function checkLegibility(input: LegibilityInput): LegibilityResult {
	const { sourceWidth, sourceHeight, targetWidth, targetHeight } = input;
	if (!Number.isFinite(targetWidth) || targetWidth <= 0) {
		throw new Error(
			`checkLegibility: targetWidth must be > 0, got ${targetWidth}`,
		);
	}
	if (!Number.isFinite(targetHeight) || targetHeight <= 0) {
		throw new Error(
			`checkLegibility: targetHeight must be > 0, got ${targetHeight}`,
		);
	}
	if (
		!Number.isFinite(sourceWidth) ||
		sourceWidth < 0 ||
		!Number.isFinite(sourceHeight) ||
		sourceHeight < 0
	) {
		throw new Error(
			`checkLegibility: source dimensions must be finite and >= 0, got ${sourceWidth}×${sourceHeight}`,
		);
	}

	const minScale = input.minScale ?? DEFAULT_MIN_LEGIBILITY_SCALE;
	const sx = sourceWidth / targetWidth;
	const sy = sourceHeight / targetHeight;
	const scale = Math.min(sx, sy);
	const limitingAxis: "width" | "height" = sx <= sy ? "width" : "height";
	return { ok: scale >= minScale, scale, minScale, limitingAxis };
}
