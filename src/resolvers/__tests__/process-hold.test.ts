import { describe, expect, it } from "vitest";
import { decideProcessHold } from "../process-hold";
import type { TabOrigin } from "../../types/tab";

describe("decideProcessHold — exhaustive truth table", () => {
	const origins: TabOrigin[] = ["fresh", "restored"];
	const cases: Array<[boolean, TabOrigin, boolean, string]> = [];
	for (const isActive of [true, false])
		for (const origin of origins)
			for (const hasForkSource of [true, false]) {
				const expected = isActive
					? "hold:active"
					: hasForkSource
						? "hold:fork"
						: origin === "fresh"
							? "hold:fresh"
							: "defer:background-restored";
				cases.push([isActive, origin, hasForkSource, expected]);
			}

	it.each(cases)(
		"isActive=%s origin=%s fork=%s → %s",
		(isActive, origin, hasForkSource, expected) => {
			const d = decideProcessHold({ isActive, origin, hasForkSource });
			expect(`${d.kind}:${d.reason}`).toBe(expected);
		},
	);

	it("only a background restored tab defers", () => {
		const defers = cases.filter(([, , , e]) => e.startsWith("defer"));
		expect(defers).toEqual([[false, "restored", false, "defer:background-restored"]]);
	});
});
