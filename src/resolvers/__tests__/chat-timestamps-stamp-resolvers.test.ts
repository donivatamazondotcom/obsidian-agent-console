/**
 * Chat Timestamps PR 2 — the pure decisions behind every stamp.
 *
 * - `deriveStampDateScope`: which date form a stamp shows (Decision 7).
 * - `deriveStampAge`: the hover age, which never falls back to a date.
 * - `deriveTurnEndStamp`: what a prompt's turn-end stamp says (Decision 2).
 *
 * The time zone is pinned so the DST cases test something in CI (UTC there).
 * Times are built with local-time constructors, so they are wall-clock times in
 * that zone.
 *
 * Spec: [[Agent Console Chat Timestamps]] § Formatting and text, § Ticker and
 * store (the day store), § Prompt and turn-end stamps.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { deriveStampDateScope } from "../stamp-date-scope";
import { deriveStampAge } from "../stamp-age";
import { deriveTurnEndStamp } from "../turn-end-stamp";
import { computeDayBounds } from "../../utils/time-format";
import type { ChatMessage } from "../../types/chat";

let savedTz: string | undefined;
beforeAll(() => {
	savedTz = process.env.TZ;
	process.env.TZ = "America/Los_Angeles";
});
afterAll(() => {
	if (savedTz === undefined) delete process.env.TZ;
	else process.env.TZ = savedTz;
});

const local = (y: number, mo: number, d: number, h = 0, mi = 0) =>
	new Date(y, mo - 1, d, h, mi).getTime();

describe("computeDayBounds", () => {
	it("gives calendar-day and calendar-year bounds", () => {
		const b = computeDayBounds(local(2026, 11, 15, 9, 18));
		expect(b.dayStart).toBe(local(2026, 11, 15));
		expect(b.nextDayStart).toBe(local(2026, 11, 16));
		expect(b.yearStart).toBe(local(2026, 1, 1));
		expect(b.nextYearStart).toBe(local(2027, 1, 1));
	});

	it("a spring-forward day is 23 hours and a fall-back day is 25", () => {
		const spring = computeDayBounds(local(2026, 3, 8, 12));
		expect(spring.nextDayStart - spring.dayStart).toBe(23 * 3_600_000);
		const fall = computeDayBounds(local(2026, 11, 1, 12));
		expect(fall.nextDayStart - fall.dayStart).toBe(25 * 3_600_000);
	});
});

describe("deriveStampDateScope", () => {
	// Computed per test, after beforeAll pins the zone: a value computed while
	// the file is collected would use the runner's zone (UTC in CI).
	let bounds: ReturnType<typeof computeDayBounds>;
	beforeEach(() => {
		bounds = computeDayBounds(local(2026, 11, 15, 9, 0));
	});

	it("today, including later today", () => {
		expect(deriveStampDateScope(local(2026, 11, 15, 0, 5), bounds)).toBe("today");
		expect(deriveStampDateScope(local(2026, 11, 15, 23, 50), bounds)).toBe("today");
	});

	it("an earlier or a future day this year", () => {
		expect(deriveStampDateScope(local(2026, 11, 14, 23, 59), bounds)).toBe("thisYear");
		expect(deriveStampDateScope(local(2026, 1, 1, 0, 0), bounds)).toBe("thisYear");
		expect(deriveStampDateScope(local(2026, 11, 16, 0, 1), bounds)).toBe("thisYear");
	});

	it("another year, including Jan 1 seen under clock skew on Dec 31", () => {
		expect(deriveStampDateScope(local(2025, 11, 14, 9, 18), bounds)).toBe("otherYear");
		const dec31 = computeDayBounds(local(2026, 12, 31, 23, 59));
		expect(deriveStampDateScope(local(2027, 1, 1, 0, 1), dec31)).toBe("otherYear");
	});

	it("DST dates: 11:30 PM is today and 12:10 AM the next day is not", () => {
		for (const [m, d] of [
			[3, 8],
			[11, 1],
		] as const) {
			const b = computeDayBounds(local(2026, m, d, 12));
			expect(deriveStampDateScope(local(2026, m, d, 23, 30), b)).toBe("today");
			expect(deriveStampDateScope(local(2026, m, d + 1, 0, 10), b)).toBe("thisYear");
		}
	});
});

describe("deriveStampAge never falls back to a date", () => {
	const MIN = 60_000;
	const HOUR = 60 * MIN;

	it("just now, minutes and hours", () => {
		const now = local(2026, 11, 15, 12);
		expect(deriveStampAge(now - 59_000, now)).toEqual({ unit: "justNow" });
		expect(deriveStampAge(now + 5 * MIN, now)).toEqual({ unit: "justNow" });
		expect(deriveStampAge(now - 13 * MIN, now)).toEqual({ unit: "minutes", count: 13 });
		expect(deriveStampAge(now - (23 * HOUR + 59 * MIN), now)).toEqual({ unit: "hours", count: 23 });
	});

	it("24 hours on the next calendar day is yesterday", () => {
		const now = local(2026, 11, 15, 12);
		expect(deriveStampAge(now - 24 * HOUR, now)).toEqual({ unit: "yesterday" });
	});

	it("counts calendar days, not 24-hour buckets", () => {
		expect(deriveStampAge(local(2026, 11, 13, 10), local(2026, 11, 15, 9))).toEqual({
			unit: "days",
			count: 2,
		});
	});

	it("spring-forward: 3/7 10:00 hovered 3/10 9:00 is 3 days", () => {
		expect(deriveStampAge(local(2026, 3, 7, 10), local(2026, 3, 10, 9))).toEqual({
			unit: "days",
			count: 3,
		});
	});

	it("fall-back: 00:30 hovered at 23:45 on the 25-hour day stays in hours", () => {
		expect(deriveStampAge(local(2026, 11, 1, 0, 30), local(2026, 11, 1, 23, 45))).toEqual({
			unit: "hours",
			count: 24,
		});
	});

	it("weeks, months (at most 11) and years at the bucket edges", () => {
		const now = local(2026, 11, 15, 12);
		const daysAgo = (n: number) => new Date(2026, 10, 15 - n, 12).getTime();
		expect(deriveStampAge(daysAgo(6), now)).toEqual({ unit: "days", count: 6 });
		expect(deriveStampAge(daysAgo(7), now)).toEqual({ unit: "weeks", count: 1 });
		expect(deriveStampAge(daysAgo(10), now)).toEqual({ unit: "weeks", count: 1 });
		expect(deriveStampAge(daysAgo(34), now)).toEqual({ unit: "weeks", count: 4 });
		expect(deriveStampAge(daysAgo(35), now)).toEqual({ unit: "months", count: 1 });
		expect(deriveStampAge(daysAgo(360), now)).toEqual({ unit: "months", count: 11 });
		expect(deriveStampAge(daysAgo(364), now)).toEqual({ unit: "months", count: 11 });
		expect(deriveStampAge(daysAgo(365), now)).toEqual({ unit: "years", count: 1 });
		expect(deriveStampAge(daysAgo(400), now)).toEqual({ unit: "years", count: 1 });
		expect(deriveStampAge(daysAgo(800), now)).toEqual({ unit: "years", count: 2 });
	});
});

describe("deriveTurnEndStamp", () => {
	const T = local(2026, 11, 15, 9, 18);
	const prompt = (fields: Partial<ChatMessage>): ChatMessage =>
		({ id: "p", role: "user", content: [], timestamp: new Date(T), ...fields }) as ChatMessage;

	it("a turn that is still running has no end stamp", () => {
		expect(deriveTurnEndStamp(prompt({ sentAt: T }))).toEqual({ kind: "none" });
		expect(deriveTurnEndStamp(prompt({ sentAt: T, turnEndedAt: null, turnEndKind: "done" }))).toEqual({
			kind: "none",
		});
	});

	it("a chat saved before this feature has no end stamp", () => {
		expect(deriveTurnEndStamp(prompt({}))).toEqual({ kind: "none" });
	});

	it("done and stopped carry the duration; an unknown duration is null", () => {
		expect(
			deriveTurnEndStamp(prompt({ turnEndedAt: T, turnEndKind: "done", turnMs: 360_000 })),
		).toEqual({ kind: "done", at: T, durationMs: 360_000 });
		expect(
			deriveTurnEndStamp(prompt({ turnEndedAt: T, turnEndKind: "stopped", turnMs: null })),
		).toEqual({ kind: "stopped", at: T, durationMs: null });
	});

	it("failed shows the time only", () => {
		expect(
			deriveTurnEndStamp(prompt({ turnEndedAt: T, turnEndKind: "failed", turnMs: 4_000 })),
		).toEqual({ kind: "failed", at: T });
	});

	it("an agent message never carries an end stamp", () => {
		const reply = { id: "a", role: "assistant", content: [], turnEndedAt: T, turnEndKind: "done" } as unknown as ChatMessage;
		expect(deriveTurnEndStamp(reply)).toEqual({ kind: "none" });
	});
});
