/**
 * `deriveStampDateScope` — which date form a chat stamp shows.
 *
 * A stamp shows its clock time alone when it falls today, adds the month and
 * day when it falls on another day this year, and adds the year too when it
 * falls in another year, because `hh:mm` alone is ambiguous (Decision 7). Future
 * times (clock skew) follow the same ranges: later today is `today`, a future
 * day this year is `thisYear`, and Jan 1 seen on Dec 31 is `otherYear`.
 *
 * The bounds come from the plugin's day store, computed once per local day or
 * time-zone change with calendar math, so 23- and 25-hour DST days classify
 * correctly and every stamp in every view agrees.
 *
 * Pure: no React, no Obsidian, no clock reads.
 *
 * Spec: [[Agent Console Chat Timestamps]] § Formatting and text.
 */

import type { DayBounds, StampDateScope } from "../types/chat-time";

export type { DayBounds, StampDateScope } from "../types/chat-time";

export function deriveStampDateScope(ms: number, bounds: DayBounds): StampDateScope {
	if (ms >= bounds.dayStart && ms < bounds.nextDayStart) return "today";
	if (ms >= bounds.yearStart && ms < bounds.nextYearStart) return "thisYear";
	return "otherYear";
}
