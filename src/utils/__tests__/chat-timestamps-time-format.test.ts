/**
 * Chat Timestamps PR 2 — stamp formatting.
 *
 * `formatStampTime` picks the clock form from the date scope (Decision 7),
 * with cached formatters built in the day store's zone. `formatStampAge` turns
 * the age resolver's result into text. `formatDuration` is the one duration
 * helper. String checks are locale-tolerant (ICU spacing, such as U+202F
 * before AM/PM, varies by version); the en strings come from the catalog.
 *
 * Spec: [[Agent Console Chat Timestamps]] § Formatting and text.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { computeDayBounds, currentZone, formatDuration } from "../time-format";
import { formatStampAge, formatStampTime } from "../../ui/TimeStamp";
import { initLocale } from "../../i18n";

let savedTz: string | undefined;
beforeAll(() => {
	savedTz = process.env.TZ;
	process.env.TZ = "America/Los_Angeles";
});
afterAll(() => {
	if (savedTz === undefined) delete process.env.TZ;
	else process.env.TZ = savedTz;
});
afterEach(() => {
	initLocale("en");
	process.env.TZ = "America/Los_Angeles";
});

const local = (y: number, mo: number, d: number, h = 0, mi = 0) =>
	new Date(y, mo - 1, d, h, mi).getTime();

function snapshotAt(now: number) {
	return { bounds: computeDayBounds(now), zone: currentZone() };
}

describe("formatStampTime", () => {
	const snap = () => snapshotAt(local(2026, 11, 15, 12));

	it("today: numeric hour and 2-digit minute, no date", () => {
		const s = formatStampTime(local(2026, 11, 15, 9, 8), snap());
		expect(s).toContain("9:08");
		expect(s).not.toContain("09:08");
		expect(s).not.toContain("15");
		expect(s).not.toContain("2026");
	});

	it("an earlier day this year adds the date, not the year", () => {
		const s = formatStampTime(local(2026, 11, 14, 9, 18), snap());
		expect(s).toContain("9:18");
		expect(s).toContain("14");
		expect(s).not.toContain("2026");
	});

	it("another year adds the year", () => {
		const s = formatStampTime(local(2025, 11, 14, 9, 18), snap());
		expect(s).toContain("9:18");
		expect(s).toContain("14");
		expect(s).toContain("2025");
	});

	it("builds its three formatters once across 1,000 stamps in one zone", () => {
		const Orig = Intl.DateTimeFormat;
		let built = 0;
		const counting = function (...args: ConstructorParameters<typeof Orig>) {
			built++;
			return new Orig(...args);
		} as unknown as typeof Intl.DateTimeFormat;
		Intl.DateTimeFormat = counting;
		try {
			// A zone the cache hasn't seen forces one rebuild of the set.
			const s = { bounds: computeDayBounds(local(2026, 11, 15, 12)), zone: "Asia/Tokyo" };
			for (let i = 0; i < 1000; i++) {
				formatStampTime(local(2026, 11, 15 - (i % 3), 9, i % 60), s);
			}
		} finally {
			Intl.DateTimeFormat = Orig;
		}
		expect(built).toBe(3);
	});

	it("prints in the snapshot's zone", () => {
		const at = Date.UTC(2026, 10, 15, 17, 18); // 9:18 AM in Los Angeles, 2:18 AM next day in Tokyo
		const la = { bounds: computeDayBounds(at), zone: "America/Los_Angeles" };
		expect(formatStampTime(at, la)).toContain("9:18");
		const tokyoBounds = { bounds: computeDayBounds(at), zone: "Asia/Tokyo" };
		expect(formatStampTime(at, tokyoBounds)).toContain("2:18");
	});

	it("an unknown or empty host zone renders without throwing", () => {
		for (const tz of ["", "Nowhere/Fake"]) {
			process.env.TZ = tz;
			const s = { bounds: computeDayBounds(local(2026, 11, 15, 12)), zone: currentZone() };
			expect(() => formatStampTime(local(2026, 11, 15, 9, 8), s)).not.toThrow();
			expect(formatStampTime(local(2026, 11, 15, 9, 8), s)).toMatch(/\d/);
		}
	});
});

describe("formatStampAge", () => {
	// Read per test, after beforeAll pins the zone (see the resolver tests).
	let now = 0;
	beforeEach(() => {
		now = local(2026, 11, 15, 12);
	});

	it("uses the history catalog's words for short ages", () => {
		expect(formatStampAge(now - 10_000, now)).toBe("just now");
		expect(formatStampAge(now - 60_000, now)).toBe("1 minute ago");
		expect(formatStampAge(now - 13 * 60_000, now)).toBe("13 minutes ago");
		expect(formatStampAge(now - 3 * 3_600_000, now)).toBe("3 hours ago");
		expect(formatStampAge(now - 24 * 3_600_000, now)).toBe("yesterday");
		expect(formatStampAge(local(2026, 11, 13, 10), local(2026, 11, 15, 9))).toBe("2 days ago");
	});

	it("an old stamp gets an age, never a date", () => {
		expect(formatStampAge(local(2026, 11, 5, 12), now)).toBe("1 week ago");
		expect(formatStampAge(local(2026, 10, 1, 12), now)).toBe("1 month ago");
		expect(formatStampAge(local(2025, 10, 11, 12), now)).toBe("1 year ago");
		expect(formatStampAge(local(2024, 11, 1, 12), now)).toBe("2 years ago");
	});

	it("is translated under the ko locale", () => {
		initLocale("ko");
		expect(formatStampAge(local(2026, 11, 5, 12), now)).toBe("1주 전");
		expect(formatStampAge(local(2026, 10, 1, 12), now)).toBe("1개월 전");
	});
});

describe("formatDuration", () => {
	it("minutes precision for turn ends", () => {
		expect(formatDuration(45_000, "minutes")).toBe("45s");
		expect(formatDuration(6 * 60_000 + 12_000, "minutes")).toBe("6m");
		expect(formatDuration(65 * 60_000, "minutes")).toBe("1h 5m");
		expect(formatDuration(120 * 60_000, "minutes")).toBe("2h");
	});

	it("seconds precision for tool rows", () => {
		expect(formatDuration(112_000, "seconds")).toBe("1m 52s");
		expect(formatDuration(120_000, "seconds")).toBe("2m");
		expect(formatDuration(3_725_000, "seconds")).toBe("1h 2m");
	});

	it("never goes below zero", () => {
		expect(formatDuration(-5_000, "minutes")).toBe("0s");
	});
});
