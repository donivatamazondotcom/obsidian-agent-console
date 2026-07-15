import { describe, it, expect } from "vitest";
import { shouldNotifySystem } from "../notify-gate";

describe("shouldNotifySystem", () => {
	it("does not notify when the setting is disabled (regardless of visibility/focus)", () => {
		expect(
			shouldNotifySystem({ visibilityState: "hidden", hasFocus: false, enabled: false }),
		).toBe(false);
		expect(
			shouldNotifySystem({ visibilityState: "visible", hasFocus: false, enabled: false }),
		).toBe(false);
	});

	it("notifies when the window is hidden even if hasFocus transiently reads true (I168 regression)", () => {
		// The exact failing combination from the I168 gate log: the permission
		// transition coincided with a commit-time focus flip in a hidden window.
		expect(
			shouldNotifySystem({ visibilityState: "hidden", hasFocus: true, enabled: true }),
		).toBe(true);
	});

	it("notifies when the window is hidden and unfocused", () => {
		expect(
			shouldNotifySystem({ visibilityState: "hidden", hasFocus: false, enabled: true }),
		).toBe(true);
	});

	it("notifies when visible but unfocused (side-by-side windows)", () => {
		expect(
			shouldNotifySystem({ visibilityState: "visible", hasFocus: false, enabled: true }),
		).toBe(true);
	});

	it("does NOT notify when visible and focused (user is looking at it)", () => {
		expect(
			shouldNotifySystem({ visibilityState: "visible", hasFocus: true, enabled: true }),
		).toBe(false);
	});
});
