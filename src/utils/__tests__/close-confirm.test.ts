import { describe, it, expect } from "vitest";
import { shouldConfirmClose, MULTI_TAB_THRESHOLD } from "../close-confirm";

describe("shouldConfirmClose", () => {
	it("does not confirm when the setting is disabled, regardless of tab count", () => {
		expect(shouldConfirmClose(0, false)).toBe(false);
		expect(shouldConfirmClose(1, false)).toBe(false);
		expect(shouldConfirmClose(2, false)).toBe(false);
		expect(shouldConfirmClose(5, false)).toBe(false);
	});

	it("does not confirm for a single tab even when enabled (unambiguous close)", () => {
		expect(shouldConfirmClose(1, true)).toBe(false);
	});

	it("does not confirm for an empty panel even when enabled", () => {
		expect(shouldConfirmClose(0, true)).toBe(false);
	});

	it("confirms at the threshold (2 tabs) when enabled", () => {
		expect(shouldConfirmClose(MULTI_TAB_THRESHOLD, true)).toBe(true);
		expect(shouldConfirmClose(2, true)).toBe(true);
	});

	it("confirms above the threshold when enabled", () => {
		expect(shouldConfirmClose(3, true)).toBe(true);
		expect(shouldConfirmClose(10, true)).toBe(true);
	});

	it("uses a threshold of 2 (browser convention)", () => {
		expect(MULTI_TAB_THRESHOLD).toBe(2);
	});
});
