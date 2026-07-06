import { describe, it, expect, vi } from "vitest";
import { runRegistrations } from "../run-registrations";

describe("I157 — runRegistrations (onload resilience harness)", () => {
	it("runs every step in order and reports no failures when all succeed", () => {
		const order: string[] = [];
		const notify = vi.fn();
		const logError = vi.fn();
		const res = runRegistrations(
			[
				{ label: "a", run: () => order.push("a") },
				{ label: "b", run: () => order.push("b") },
			],
			{ notify, logError },
		);
		expect(order).toEqual(["a", "b"]);
		expect(res).toEqual({ ok: ["a", "b"], failed: [] });
		expect(notify).not.toHaveBeenCalled();
		expect(logError).not.toHaveBeenCalled();
	});

	it("a throwing step does NOT abort the rest (the I157 total-abort is gone) and is reported once", () => {
		const order: string[] = [];
		const notify = vi.fn();
		const logError = vi.fn();
		const res = runRegistrations(
			[
				{ label: "chat panel view", run: () => order.push("view") },
				{
					label: "commands",
					run: () => {
						throw new Error("duplicate command id");
					},
				},
				{ label: "settings tab", run: () => order.push("settings") },
			],
			{ notify, logError },
		);
		// The step AFTER the failure still ran — this is the whole point.
		expect(order).toEqual(["view", "settings"]);
		expect(res.ok).toEqual(["chat panel view", "settings tab"]);
		expect(res.failed).toEqual(["commands"]);
		expect(logError).toHaveBeenCalledOnce();
		expect(notify).toHaveBeenCalledOnce();
		expect(notify.mock.calls[0][0]).toContain("commands");
	});

	it("collects multiple failures into a single notice", () => {
		const notify = vi.fn();
		const logError = vi.fn();
		const res = runRegistrations(
			[
				{ label: "one", run: () => { throw new Error("x"); } },
				{ label: "two", run: () => { throw new Error("y"); } },
			],
			{ notify, logError },
		);
		expect(res.failed).toEqual(["one", "two"]);
		expect(notify).toHaveBeenCalledOnce();
		expect(logError).toHaveBeenCalledTimes(2);
	});
});
