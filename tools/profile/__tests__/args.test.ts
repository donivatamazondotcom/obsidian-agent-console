/**
 * CLI argument parsing rejects malformed values instead of guessing: a NaN
 * threshold used to disable the gate, and `--runs=0` silently became 5.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2.
 */
import { describe, it, expect } from "vitest";
import { parseArgs } from "../run-profile";

describe("parseArgs", () => {
	it("parses the documented flags", () => {
		const a = parseArgs(["--record", "--runs=7", "--vault=ST-x", "--threshold=0.25", "--no-seed", "--sha=abc"]);
		expect(a).toMatchObject({ record: true, runs: 7, vault: "ST-x", threshold: 0.25, seed: false, sha: "abc" });
	});

	it("rejects a non-numeric or non-positive threshold", () => {
		expect(() => parseArgs(["--threshold=abc"])).toThrow(/threshold/);
		expect(() => parseArgs(["--threshold=0"])).toThrow(/threshold/);
	});

	it("rejects --runs below 1 or not whole", () => {
		expect(() => parseArgs(["--runs=0"])).toThrow(/runs/);
		expect(() => parseArgs(["--runs=2.5"])).toThrow(/runs/);
	});

	it("rejects an unknown argument", () => {
		expect(() => parseArgs(["--vualt=studio"])).toThrow(/unknown argument/);
	});
});
