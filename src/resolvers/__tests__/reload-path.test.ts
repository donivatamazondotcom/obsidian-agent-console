/**
 * I251 — `decideReloadPath` truth table. Literals only (R5).
 */
import { describe, expect, it } from "vitest";
import { decideReloadPath } from "../reload-path";

describe("decideReloadPath", () => {
	it.each([
		[true, true, "busy"],
		[false, true, "busy"],
		[true, false, "reload"],
		[false, false, "connect"],
	] as const)(
		"bound=%s, in flight=%s → %s",
		(hasBoundSession, acquisitionInFlight, kind) => {
			expect(
				decideReloadPath({ hasBoundSession, acquisitionInFlight }),
			).toEqual({ kind });
		},
	);
});
