import { describe, it, expect } from "vitest";
import { captureDpr, isolatedRunProblems, nothingToCaptureMessage, reportRun } from "../run-report";

const ok = (name: string) => ({ name, success: true });
const fail = (name: string, error: string) => ({ name, success: false, error });
const skip = (name: string) => ({ name, success: true, skipped: "needs the real screen" });

describe("reportRun", () => {
	it("passes when every captured entry passed", () => {
		const r = reportRun([ok("a"), skip("b")], []);
		expect(r.exitCode).toBe(0);
		expect(r.errors).toEqual([]);
		expect(r.lines.at(-1)).toMatch(/Done\. 1 screenshot\(s\) written/);
	});

	it("fails and counts failed entries", () => {
		const r = reportRun([ok("a"), fail("b", "boom")], []);
		expect(r.exitCode).toBe(1);
		expect(r.lines).toContain("  ✗ b — boom");
		expect(r.errors.at(-1)).toMatch(/1 screenshot\(s\) failed/);
	});

	it("fails on run-level problems even when every entry passed", () => {
		const r = reportRun([ok("a")], ["3 focus steals, over the budget of 2"]);
		expect(r.exitCode).toBe(1);
		expect(r.errors[0]).toMatch(/focus steals/);
	});

	it("fails when every entry was skipped, pointing at SCREENSHOT_LEGACY=1", () => {
		const r = reportRun([skip("language-setting")], []);
		expect(r.exitCode).toBe(1);
		expect(r.errors.join("\n")).toMatch(/nothing was captured.*SCREENSHOT_LEGACY=1/);
	});
});

describe("isolatedRunProblems", () => {
	it("is empty within the focus budget and with no harness problems", () => {
		expect(isolatedRunProblems({ steals: 2, problems: [] }, 2)).toEqual([]);
	});

	it("reports steals over the budget and harness problems", () => {
		const p = isolatedRunProblems({ steals: 3, problems: ["1 process(es) still carry the run markers: 42"] }, 2);
		expect(p).toHaveLength(2);
		expect(p.join("\n")).toMatch(/run markers: 42/);
		expect(p.join("\n")).toMatch(/3 focus steals, over the budget of 2/);
	});
});

describe("captureDpr", () => {
	it("is always 2 in isolated mode, without asking the page", async () => {
		let asked = false;
		expect(await captureDpr({}, true, () => { asked = true; return Promise.resolve(1); })).toBe(2);
		expect(asked).toBe(false);
	});

	it("reads the page on the legacy path", async () => {
		expect(await captureDpr({}, false, () => Promise.resolve(1))).toBe(1);
	});

	it("honors SCREENSHOT_DPR on both paths", async () => {
		expect(await captureDpr({ SCREENSHOT_DPR: "3" }, true, () => Promise.resolve(1))).toBe(3);
		expect(await captureDpr({ SCREENSHOT_DPR: "3" }, false, () => Promise.resolve(1))).toBe(3);
	});
});

describe("nothingToCaptureMessage", () => {
	const needs = (e: { name: string }) => (e.name.startsWith("settings") ? "needs the settings window" : undefined);
	it("is null when at least one selected entry can run", () => {
		expect(nothingToCaptureMessage([{ name: "settings-a" }, { name: "ribbon" }], needs)).toBeNull();
	});
	it("names SCREENSHOT_LEGACY=1 when every selected entry would be skipped, so nothing is launched", () => {
		expect(nothingToCaptureMessage([{ name: "settings-a" }], needs)).toMatch(/settings-a.*SCREENSHOT_LEGACY=1/);
	});
});
