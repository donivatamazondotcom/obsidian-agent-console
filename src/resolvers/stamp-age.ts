/**
 * `deriveStampAge` — how old a chat stamp is, for its hover tooltip.
 *
 * Unlike the session-history formatter, this never falls back to a date: the
 * stamp itself already shows the date (Decision 7), so the tooltip's job is the
 * age. Under a day it counts minutes and hours. From a day on it counts local
 * calendar days, so "yesterday" means the calendar day before today, not a
 * 24–48 hour bucket.
 *
 * The day count uses `Date.UTC` of each time's local date parts, which never
 * sees a 23- or 25-hour day, rounded. On the 25-hour fall-back day, a time more
 * than 24 hours ago can still be today; that reads in hours.
 *
 * Pure apart from reading the local calendar of the two given times; no React,
 * no Obsidian, no clock reads.
 *
 * Spec: [[Agent Console Chat Timestamps]] § Formatting and text.
 */

import type { StampAge } from "../types/chat-time";

export type { StampAge } from "../types/chat-time";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Calendar days from `then`'s local date to `now`'s local date. */
function localDayDiff(thenMs: number, nowMs: number): number {
	const t = new Date(thenMs);
	const n = new Date(nowMs);
	const tDay = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
	const nDay = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
	return Math.round((nDay - tDay) / DAY);
}

export function deriveStampAge(thenMs: number, nowMs: number): StampAge {
	const elapsed = nowMs - thenMs;
	if (elapsed < MINUTE) return { unit: "justNow" };
	if (elapsed < HOUR) return { unit: "minutes", count: Math.floor(elapsed / MINUTE) };
	const days = localDayDiff(thenMs, nowMs);
	if (elapsed < DAY || days <= 0) {
		return { unit: "hours", count: Math.floor(elapsed / HOUR) };
	}
	if (days === 1) return { unit: "yesterday" };
	if (days < 7) return { unit: "days", count: days };
	if (days < 35) return { unit: "weeks", count: Math.floor(days / 7) };
	if (days < 365) {
		return { unit: "months", count: Math.min(11, Math.max(1, Math.floor(days / 30))) };
	}
	return { unit: "years", count: Math.max(1, Math.floor(days / 365)) };
}
