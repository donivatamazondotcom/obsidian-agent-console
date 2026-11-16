/**
 * Chat Timestamps — formatting for stamps, ages and durations.
 *
 * Clock times use the system locale with a numeric hour and 2-digit minute
 * (`9:18 AM`), through three module-level `Intl.DateTimeFormat` instances
 * (clock; with month and day; with month, day and year), because
 * `toLocaleTimeString` with options builds a formatter on every call. Which one
 * a stamp uses is decided by `deriveStampDateScope` from the day store's bounds;
 * `ui/TimeStamp.tsx` composes the two (`formatStampTime`, `formatStampAge`).
 *
 * The formatters are built with the day store's zone as an explicit `timeZone`,
 * so a formatter always prints in the zone it is filed under, and rebuilt only
 * when that zone changes. A host that reports no usable zone (an empty `TZ`
 * reports `Etc/Unknown`, which the constructor rejects) gets formatters built
 * without `timeZone`, so a bad host setting can't crash a chat tab.
 *
 * Spec: [[Agent Console Chat Timestamps]] § Formatting and text.
 */
import { t } from "../i18n";
import type { DayBounds, StampAge, StampDateScope } from "../types/chat-time";

export type { DaySnapshot } from "../types/chat-time";

/** Local calendar bounds of the day and year containing `now` (DST-safe). */
export function computeDayBounds(now: number): DayBounds {
	const d = new Date(now);
	const y = d.getFullYear();
	const m = d.getMonth();
	const day = d.getDate();
	return {
		dayStart: new Date(y, m, day).getTime(),
		nextDayStart: new Date(y, m, day + 1).getTime(),
		yearStart: new Date(y, 0, 1).getTime(),
		nextYearStart: new Date(y + 1, 0, 1).getTime(),
	};
}

/** The host's current time zone, as the runtime reports it (may be undefined). */
export function currentZone(): string | undefined {
	return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

interface Formatters {
	zone: string | undefined;
	clock: Intl.DateTimeFormat;
	date: Intl.DateTimeFormat;
	year: Intl.DateTimeFormat;
}

const CLOCK: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
const WITH_DATE: Intl.DateTimeFormatOptions = { ...CLOCK, month: "short", day: "numeric" };
const WITH_YEAR: Intl.DateTimeFormatOptions = { ...WITH_DATE, year: "numeric" };

let cache: Formatters | null = null;

function build(zone: string | undefined): Formatters {
	const make = (opts: Intl.DateTimeFormatOptions, tz: string | undefined) =>
		new Intl.DateTimeFormat(undefined, tz === undefined ? opts : { ...opts, timeZone: tz });
	try {
		const clock = make(CLOCK, zone);
		return { zone, clock, date: make(WITH_DATE, zone), year: make(WITH_YEAR, zone) };
	} catch {
		// The runtime named a zone it won't accept. Print in the default zone
		// rather than throw inside a render.
		return { zone, clock: make(CLOCK, undefined), date: make(WITH_DATE, undefined), year: make(WITH_YEAR, undefined) };
	}
}

function formattersFor(zone: string | undefined): Formatters {
	if (cache === null || cache.zone !== zone) cache = build(zone);
	return cache;
}

/**
 * A clock text in the given date form (Decision 7), printed in `zone` with the
 * cached formatters. The form is decided by `deriveStampDateScope`.
 */
export function formatClock(ms: number, scope: StampDateScope, zone: string | undefined): string {
	const f = formattersFor(zone);
	switch (scope) {
		case "today":
			return f.clock.format(ms);
		case "thisYear":
			return f.date.format(ms);
		case "otherYear":
			return f.year.format(ms);
	}
}

/** A stamp's age as text (from `deriveStampAge`). Never a date. */
export function formatAgeText(age: StampAge): string {
	switch (age.unit) {
		case "justNow":
			return t("chat.history.justNow");
		case "yesterday":
			return t("chat.history.yesterday");
		case "minutes":
			return age.count === 1
				? t("chat.history.minutesAgo_one")
				: t("chat.history.minutesAgo_other", { count: age.count });
		case "hours":
			return age.count === 1
				? t("chat.history.hoursAgo_one")
				: t("chat.history.hoursAgo_other", { count: age.count });
		case "days":
			return t("chat.history.daysAgo", { count: age.count });
		case "weeks":
			return age.count === 1
				? t("chat.history.weeksAgo_one")
				: t("chat.history.weeksAgo_other", { count: age.count });
		case "months":
			return age.count === 1
				? t("chat.history.monthsAgo_one")
				: t("chat.history.monthsAgo_other", { count: age.count });
		case "years":
			return age.count === 1
				? t("chat.history.yearsAgo_one")
				: t("chat.history.yearsAgo_other", { count: age.count });
	}
}

/**
 * A duration: `45s`, `6m`, `1h 5m` at minutes precision (turn ends), or
 * `1m 52s` at seconds precision (tool rows). Never below zero.
 */
export function formatDuration(ms: number, precision: "minutes" | "seconds"): string {
	const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
	if (totalSeconds < 60) return t("chat.duration.seconds", { seconds: totalSeconds });
	const totalMinutes = Math.floor(totalSeconds / 60);
	if (totalMinutes < 60) {
		const seconds = totalSeconds % 60;
		return precision === "seconds" && seconds > 0
			? t("chat.duration.minutesSeconds", { minutes: totalMinutes, seconds })
			: t("chat.duration.minutes", { minutes: totalMinutes });
	}
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return minutes > 0
		? t("chat.duration.hoursMinutes", { hours, minutes })
		: t("chat.duration.hours", { hours });
}

/**
 * A short age for the live status line and running tool rows (Chat
 * Timestamps PR 3): `just now` under a second, `Ns ago` every second to
 * 59, then `Nm ago` and `Nh ago`. Never negative (clock skew reads as
 * `just now`). Hover ages keep the long forms of `formatAgeText`.
 */
export function formatShortAge(ms: number): string {
	const seconds = Math.floor(Math.max(0, ms) / 1000);
	if (seconds < 1) return t("chat.history.justNow");
	if (seconds < 60) return t("chat.age.seconds", { count: seconds });
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return t("chat.age.minutes", { count: minutes });
	return t("chat.age.hours", { count: Math.floor(minutes / 60) });
}
