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

/**
 * When a terminal the plugin runs last printed, exited and was released
 * (Chat Timestamps PR 3; epoch ms, null = not yet). Kept by TerminalManager.
 */
export interface TerminalTiming {
	lastOutputAt: number | null;
	exitedAt: number | null;
	releasedAt: number | null;
}

/**
 * The live turn's clocks, read synchronously by the per-second ticker
 * (`useAgentMessages.getLiveTurnClock`). Null outside a live turn.
 */
export interface LiveTurnClock {
	promptId: string;
	sentAt: number;
	/** The turn's last live (allowlisted) update; the send until one arrives. */
	lastUpdateAt: number;
	/** Whether any live update has arrived in this turn. */
	hasUpdate: boolean;
	/** Start of an open permission wait, or null. */
	waitStartedAt: number | null;
	/** The turn's finished permission waits so far. */
	turnWaitMs: number;
	/** Tool call id → when its last output update arrived (agent-run tools that stream output). */
	lastOutputAtByCall: ReadonlyMap<string, number>;
}

/** What the live line and the running rows show: relative facts only. */
export interface TurnActivity {
	/** The line's facts (`Working 4m · last update 10s ago`, or `· 5m` after a title). */
	line: string | null;
	/**
	 * The running tool the line names (`Running: npm test`), kept apart from
	 * the facts so a long title is cut before they are. Null otherwise.
	 */
	lineTitle?: string | null;
	/** Tool call id → its running row's text. */
	rows: Readonly<Record<string, string>>;
}
