/**
 * `deriveTabKeyTarget` — pure resolver for keyboard navigation across the
 * session tab strip (TS-I08).
 *
 * Follows the WAI-ARIA tabs pattern with MANUAL activation: Left/Right
 * (wrapping) and Home/End move focus only; Enter/Space selection is handled by
 * the tab itself. Manual rather than automatic activation because selecting a
 * tab can start an agent session — arrowing past a tab must not.
 *
 * On the vertical tab rail, Delete or Backspace on a focused key closes that
 * tab (`{ kind: "close" }`, I301; the optional "Delete" key in the WAI-ARIA
 * tabs pattern). A held (repeated) or modified Delete/Backspace does nothing,
 * so holding the key closes one tab, not a run of them – a close stops a
 * running agent and asks no confirmation. The strip has no Delete close.
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
	/**
	 * Strip (default) or the vertical tab rail. Vertical uses ArrowDown /
	 * ArrowUp instead of ArrowRight / ArrowLeft ([[Agent Console Vertical Tab
	 * Rail]]).
	 */
	orientation?: "horizontal" | "vertical";
	/** `KeyboardEvent.repeat`. Only Delete/Backspace read it. */
	repeat?: boolean;
	/** Any of Meta/Ctrl/Alt/Shift held. Only Delete/Backspace read it. */
	hasModifier?: boolean;
}

export type TabKeyTarget =
	| { kind: "focus"; index: number }
	| { kind: "close" }
	| { kind: "none" };

const NONE: TabKeyTarget = { kind: "none" };

/** Keys that close a focused rail key (the Mac "delete" key reports Backspace). */
const CLOSE_KEYS: ReadonlySet<string> = new Set(["Delete", "Backspace"]);

/**
 * Navigation keys → target index. A lookup table, not a `switch`: the input is
 * an open-ended `KeyboardEvent.key` string, not a union, so "any other key"
 * is a real case (returns none) rather than an impossible branch.
 */
type NavKeyMap = Readonly<Record<string, (index: number, count: number) => number>>;

const NAV_KEYS: NavKeyMap = {
	ArrowRight: (i, n) => (i + 1) % n,
	ArrowLeft: (i, n) => (i - 1 + n) % n,
	Home: () => 0,
	End: (_i, n) => n - 1,
};

const VERTICAL_NAV_KEYS: NavKeyMap = {
	ArrowDown: (i, n) => (i + 1) % n,
	ArrowUp: (i, n) => (i - 1 + n) % n,
	Home: () => 0,
	End: (_i, n) => n - 1,
};

export function deriveTabKeyTarget({
	key,
	index,
	count,
	orientation = "horizontal",
	repeat = false,
	hasModifier = false,
}: TabKeyInput): TabKeyTarget {
	if (!Number.isInteger(count) || count < 1) return NONE;
	if (!Number.isInteger(index) || index < 0 || index >= count) return NONE;

	// Before the nav lookup: that lookup doesn't know Delete, and a one-tab
	// rail must still close.
	if (orientation === "vertical" && CLOSE_KEYS.has(key)) {
		return repeat || hasModifier ? NONE : { kind: "close" };
	}

	const keys = orientation === "vertical" ? VERTICAL_NAV_KEYS : NAV_KEYS;
	if (!Object.prototype.hasOwnProperty.call(keys, key)) return NONE;
	const next = keys[key](index, count);
	return next === index ? NONE : { kind: "focus", index: next };
}
