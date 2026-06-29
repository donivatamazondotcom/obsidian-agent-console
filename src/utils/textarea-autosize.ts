/**
 * Pure resolver for the composer textarea's auto-resize decision.
 *
 * Why this exists (I-S13): the composer's `adjustTextareaHeight` used to toggle
 * the live textarea to `height: auto` on EVERY keystroke to measure its content
 * height. The composer is a flex sibling of the message list's scroll
 * container, so that momentary relayout — especially while the composer is
 * parked at `max-height` — made the browser revert the message list's
 * `scrollTop` by a large amount (a measured ~220px jump). `useAutoScrollPin`
 * then read that revert as a user scroll-up (gap > STICK_OFFSET_PX) and
 * unpinned the chat from the bottom.
 *
 * The fix: when the textarea is already OVERFLOWING, its `scrollHeight` already
 * reports the true content height, so there is no need to toggle `height: auto`
 * at all — we derive the height directly and the caller skips any DOM mutation
 * when the height is unchanged. The `height: auto` collapse is only required on
 * the cold SHRINK path (content was deleted so the rendered box may be taller
 * than its content), which never happens while overflowing at max-height.
 *
 * See 04-initiatives/Agent Console/ACP Scroll Architecture Rework.md § I-S13.
 *
 * This is a "one decision = one pure resolver" unit per the repo's engineering
 * tenets ([[Agent Console]] § Tenets → Engineering): total, no DOM, no React,
 * returns a tagged union so illegal combinations are unrepresentable.
 */

/** Minimum rendered height of the composer textarea (px). */
export const TEXTAREA_MIN_HEIGHT = 80;

/** Maximum rendered height of the composer textarea (px), then it scrolls internally. */
export const TEXTAREA_MAX_HEIGHT = 300;

export type TextareaResizeDecision =
	| {
			/**
			 * The textarea is overflowing, so `scrollHeight` already reflects the
			 * needed content height. Apply this clamped height WITHOUT a
			 * `height: auto` toggle — the hot path (typing while tall / at
			 * max-height) never thrashes layout.
			 */
			kind: "apply";
			heightPx: number;
	  }
	| {
			/**
			 * The textarea is not overflowing, so its content might be shorter
			 * than the rendered box (e.g. after deleting lines). The true content
			 * height can only be measured by letting the element collapse, so the
			 * caller must toggle `height: auto`, re-read `scrollHeight`, and clamp.
			 * This is the cold shrink path only.
			 */
			kind: "measure-collapsed";
	  };

/** Clamp a measured content height into the composer's [min, max] band. */
export function clampTextareaHeight(
	scrollHeight: number,
	min: number = TEXTAREA_MIN_HEIGHT,
	max: number = TEXTAREA_MAX_HEIGHT,
): number {
	return Math.max(min, Math.min(scrollHeight, max));
}

/**
 * Decide how to size the composer textarea from a non-mutating measurement of
 * the live element (`scrollHeight` and `clientHeight` read at its current
 * rendered height).
 *
 * - Overflowing (`scrollHeight > clientHeight`): content exceeds the rendered
 *   box, so `scrollHeight` is the true content height → `apply` the clamped
 *   value with no relayout.
 * - Otherwise: the box may be taller than its content → `measure-collapsed`
 *   (caller collapses to measure).
 */
export function decideTextareaResize(params: {
	scrollHeight: number;
	clientHeight: number;
	min?: number;
	max?: number;
}): TextareaResizeDecision {
	const min = params.min ?? TEXTAREA_MIN_HEIGHT;
	const max = params.max ?? TEXTAREA_MAX_HEIGHT;
	if (params.scrollHeight > params.clientHeight) {
		return { kind: "apply", heightPx: clampTextareaHeight(params.scrollHeight, min, max) };
	}
	return { kind: "measure-collapsed" };
}
