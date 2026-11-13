/**
 * CRC-32 over UTF-8, as Python's `zlib.crc32(s.encode("utf-8"))` computes it.
 * Spec: [[Agent Console Fresh-Session Handoff]] T04. The expected values were
 * computed with Python 3 `zlib.crc32` and committed as constants, so this
 * test checks the TypeScript against the sender's implementation, not itself.
 *
 * Red-first: written before `src/utils/crc32.ts` exists.
 */
import { describe, it, expect } from "vitest";
import { crc32, crc32Hex } from "../crc32";

describe("crc32 (T04)", () => {
	it("matches the standard check value", () => {
		expect(crc32Hex("123456789")).toBe("cbf43926");
		expect(crc32("123456789")).toBe(0xcbf43926);
	});

	it("pads a value with a leading zero to eight hex digits", () => {
		expect(crc32Hex("handoff 53")).toBe("040b1197");
	});

	it.each([
		["emoji", "Ship \u{1F468}\u200D\u{1F469}\u200D\u{1F467} today \u{1F642}", "e3aebc2d"],
		["non-BMP letters", "\u{1D49C}\u{1D4C1}\u{1D4C5}\u{1D4BD}\u{1D4B6} \u{2070E} \u{1F600}", "df92ef05"],
		["CRLF line endings", "line one\r\nline two\r\n", "da84e5d4"],
		["hidden characters", "a\u200Bb \u{1F468}\u200D\u{1F469}\u200D\u{1F467}", "186fe957"],
		["empty text", "", "00000000"],
	])("matches Python for %s", (_name, text, expected) => {
		expect(crc32Hex(text)).toBe(expected);
	});
});
