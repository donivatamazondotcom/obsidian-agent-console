import { describe, it, expect } from "vitest";
import {
	DEFAULT_TITLE_STRATEGY,
	TITLE_STRATEGY_OPTIONS,
	TITLE_STRATEGY_VALUES,
} from "../title-strategy";

describe("title-strategy module (F03)", () => {
	it("defaults to agent-suggested (D1)", () => {
		expect(DEFAULT_TITLE_STRATEGY).toBe("agent-suggested");
	});

	it("exposes exactly the three strategy values", () => {
		expect(TITLE_STRATEGY_VALUES).toEqual([
			"agent-suggested",
			"prompt-derived",
			"agent-timestamp",
		]);
	});

	it("every strategy value has exactly one labeled dropdown option", () => {
		// Guards the 'added a strategy but forgot the dropdown option'
		// regression: the option set must be a 1:1 cover of the value set.
		const optionValues = TITLE_STRATEGY_OPTIONS.map((o) => o.value).sort();
		expect(optionValues).toEqual([...TITLE_STRATEGY_VALUES].sort());
		for (const { label } of TITLE_STRATEGY_OPTIONS) {
			expect(label.trim().length).toBeGreaterThan(0);
		}
	});

	it("the default is one of the offered options", () => {
		expect(
			TITLE_STRATEGY_OPTIONS.some(
				(o) => o.value === DEFAULT_TITLE_STRATEGY,
			),
		).toBe(true);
	});
});
