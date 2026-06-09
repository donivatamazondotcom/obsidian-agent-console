/**
 * Content guard for screenshot captures (I11 follow-up).
 *
 * The capture pipeline previously reported success on exit code + output
 * dimensions alone — it had no notion of whether the captured image actually
 * contained content. The I11 retina-DPR regression produced blank /
 * half-resolution shots that still exited ✓: `ribbon-icon` collapsed to ~400
 * distinct colors (tooltip lost) vs ~1713 healthy, and the
 * `session-history-button` group crop went to ~28 (blank) vs ~520. It went
 * unnoticed until the actual images were eyeballed.
 *
 * This module counts distinct RGB colors in a decoded image. A blank or
 * degraded capture collapses toward a handful of colors; a healthy shot has
 * hundreds-to-thousands. The orchestrator compares the count against a
 * per-entry floor (manifest `minDistinctColors`, else
 * `DEFAULT_MIN_DISTINCT_COLORS`) and fails loudly below it.
 *
 * Distinct colors are keyed on RGB only (alpha ignored): the drop-shadow
 * margin is fully transparent and collapses to a single color, which matches
 * the committed-file calibration — the counts were measured on the post-shadow
 * webp (ribbon-icon 1713, session-history-button 520, mode-selection 2794,
 * multi-session 4800).
 *
 * Spec: [[Agent Console Screenshot Automation]] § Known Issues (I11 follow-up).
 * Test contract: tools/screenshots/lib/__tests__/content-guard.test.ts.
 */

/**
 * Global fallback floor applied when a manifest entry sets no
 * `minDistinctColors`. Deliberately low — a pure blank-capture catcher that
 * never false-positives a legitimately simple shot.
 *
 * Per-entry floors do the calibrated work; a single global floor is
 * mathematically impossible because the GOOD/BAD ranges overlap across
 * entries (a degraded ribbon-icon at 400 colors exceeds a healthy
 * session-history-button at 219, so no one threshold separates good from bad
 * for every entry).
 */
export const DEFAULT_MIN_DISTINCT_COLORS = 50;

/**
 * Count distinct RGB colors in a raw interleaved pixel buffer.
 *
 * Alpha is ignored — the stride is `channels`, but only the R, G, B bytes are
 * keyed — so fully-transparent shadow-margin pixels collapse to a single
 * color, matching the committed-webp calibration surface.
 *
 * @param data - raw interleaved pixel bytes (e.g. from `sharp().raw().toBuffer()`)
 * @param channels - bytes per pixel (3 = RGB, 4 = RGBA)
 * @returns number of distinct RGB triples present
 * @throws when `channels` < 3 (no RGB to key on)
 */
export function countDistinctColors(data: Buffer, channels: number): number {
	if (!Number.isInteger(channels) || channels < 3) {
		throw new Error(
			`countDistinctColors: need at least 3 channels (RGB), got ${channels}`,
		);
	}
	const seen = new Set<number>();
	// Stop at i + 2 so a trailing partial pixel can't read past the buffer.
	for (let i = 0; i + 2 < data.length; i += channels) {
		// Pack RGB into one int key; >>> 0 normalizes to an unsigned 32-bit int.
		seen.add(((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) >>> 0);
	}
	return seen.size;
}
