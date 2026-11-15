/**
 * Chat Timestamps — shared types for stamps, their date form and their age.
 *
 * Lives in `types/` so `utils/` (formatting), `resolvers/` (decisions) and
 * `services/` (the day store) can all use them without a backwards layer edge.
 *
 * Spec: [[Agent Console Chat Timestamps]] § Formatting and text.
 */

/** Local calendar bounds for "today" and "this year", as epoch ms. */
export interface DayBounds {
	/** Local midnight that starts today. */
	dayStart: number;
	/** Local midnight that starts tomorrow (23 or 25 hours later on DST days). */
	nextDayStart: number;
	/** Local midnight that starts Jan 1 of this year. */
	yearStart: number;
	/** Local midnight that starts Jan 1 of next year. */
	nextYearStart: number;
}

/** What the day store publishes: today's bounds and the zone they were computed in. */
export interface DaySnapshot {
	bounds: DayBounds;
	zone: string | undefined;
}

/** Which date form a stamp shows (Decision 7). */
export type StampDateScope = "today" | "thisYear" | "otherYear";

/** How old a stamp is, for its hover tooltip. Never a date. */
export type StampAge =
	| { unit: "justNow" }
	| { unit: "yesterday" }
	| {
			unit: "minutes" | "hours" | "days" | "weeks" | "months" | "years";
			count: number;
	  };
