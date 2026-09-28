/**
 * Pure tab-label helpers, shared by the tab manager hook and resolvers
 * (moved out of hooks/useTabManager so resolvers can use them without a
 * backwards layer edge — F15).
 */

export function truncateLabel(text: string, max = 100): string {
	return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/**
 * F03 — disambiguate an auto-applied tab label against other open tabs'
 * labels with a filesystem-style numeric suffix.
 *
 * `Fix scroll jitter` → `Fix scroll jitter (2)` → `Fix scroll jitter (3)` …
 *
 * Pure: takes the candidate label and the labels of the OTHER tabs (caller
 * excludes the tab being labeled). Returns the candidate unchanged when there
 * is no collision. Applied at apply time only — never retroactively renumbered
 * when a sibling closes. Manual renames are NOT suffixed (they reject
 * duplicates instead — T40/I22); this is for auto-applied titles only.
 */
export function suffixOnCollision(
	label: string,
	otherLabels: string[],
): string {
	const taken = new Set(otherLabels);
	if (!taken.has(label)) return label;
	let n = 2;
	while (taken.has(`${label} (${n})`)) n += 1;
	return `${label} (${n})`;
}
