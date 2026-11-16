/**
 * Chat Timestamps PR 3: the short age for the live line and running rows
 * (spec § Formatting and text): `just now` under a second, `Ns ago` every
 * second to 59, then `Nm ago` and `Nh ago`. Never negative.
 */
import { describe, expect, it } from "vitest";
import { formatShortAge } from "../time-format";

describe("formatShortAge", () => {
	it.each([
		[0, "just now"],
		[500, "just now"],
		[-3_000, "just now"],
		[1_000, "1s ago"],
		[1_999, "1s ago"],
		[59_000, "59s ago"],
		[59_999, "59s ago"],
		[60_000, "1m ago"],
		[59 * 60_000 + 59_000, "59m ago"],
		[60 * 60_000, "1h ago"],
		[61 * 60_000, "1h ago"],
		[26 * 60 * 60_000, "26h ago"],
	])("%i ms → %s", (ms, text) => {
		expect(formatShortAge(ms)).toBe(text);
	});
});
