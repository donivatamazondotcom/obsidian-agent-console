import { describe, it, expect } from "vitest";
import { decideKeepSessionId } from "../keep-session-id";

describe("decideKeepSessionId (I237, I318)", () => {
	it.each([
		[{ hasMessages: false, holdsKeptId: false }, false],
		[{ hasMessages: true, holdsKeptId: false }, true],
		[{ hasMessages: false, holdsKeptId: true }, true],
		[{ hasMessages: true, holdsKeptId: true }, true],
	])("%o -> %s", (input, expected) => {
		expect(decideKeepSessionId(input)).toBe(expected);
	});
});
