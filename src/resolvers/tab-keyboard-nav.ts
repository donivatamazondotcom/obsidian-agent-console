/**
 * `deriveTabKeyTarget` — pure resolver for keyboard navigation across the
 * session tab strip (TS-I08).
 *
 * Follows the WAI-ARIA tabs pattern with MANUAL activation: Left/Right
 * (wrapping) and Home/End move focus only; Enter/Space selection is handled by
 * the tab itself. Manual rather than automatic activation because selecting a
 * tab can start an agent session — arrowing past a tab must not.
 *
 * Pure: no React, no Obsidian. Total: never throws; anything it doesn't handle
 * (other keys, one-tab strips, out-of-range input, a move onto the same tab)
 * returns `{ kind: "none" }` so the caller leaves the event alone.
 */

export interface TabKeyInput {
	/** `KeyboardEvent.key`. */
	key: string;
	/** Index of the tab that currently has focus. */
	index: number;
	/** Number of tabs in the strip. */
	count: number;
}

export type TabKeyTarget = { kind: "focus"; index: number } | { kind: "none" };

const NONE: TabKeyTarget = { kind: "none" };

/**
 * Navigation keys → target index. A lookup table, not a `switch`: the input is
 * an open-ended `KeyboardEvent.key` string, not a union, so "any other key"
 * is a real case (returns none) rather than an impossible branch.
 */
const NAV_KEYS: Readonly<Record<string, (index: number, count: number) => number>> = {
	ArrowRight: (i, n) => (i + 1) % n,
	ArrowLeft: (i, n) => (i - 1 + n) % n,
	Home: () => 0,
	End: (_i, n) => n - 1,
};

export function deriveTabKeyTarget({
	key,
	index,
	count,
}: TabKeyInput): TabKeyTarget {
	if (!Number.isInteger(count) || count < 1) return NONE;
	if (!Number.isInteger(index) || index < 0 || index >= count) return NONE;

	if (!Object.prototype.hasOwnProperty.call(NAV_KEYS, key)) return NONE;
	const next = NAV_KEYS[key](index, count);
	return next === index ? NONE : { kind: "focus", index: next };
}
