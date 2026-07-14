import { describe, expect, it } from "vitest";
import { formatReport, isAllowedVault, parseArgs } from "../run";
import type { InvariantResult } from "../lib/invariants";

describe("isAllowedVault — smoke-vault guard", () => {
	it("allows studio", () => {
		expect(isAllowedVault("studio", false)).toBe(true);
	});
	it("allows ST-* worktree studios", () => {
		expect(isAllowedVault("ST-my-feature", false)).toBe(true);
	});
	it("refuses a working vault", () => {
		expect(isAllowedVault("donivatamazondotcom", false)).toBe(false);
	});
	it("refuses vault names merely containing ST-", () => {
		expect(isAllowedVault("myST-vault", false)).toBe(false);
	});
	it("refuses null vault even with override", () => {
		expect(isAllowedVault(null, true)).toBe(false);
	});
	it("override allows a non-smoke vault", () => {
		expect(isAllowedVault("anything", true)).toBe(true);
	});
});

describe("parseArgs", () => {
	it("parses vault, only list, and override flag", () => {
		const args = parseArgs([
			"--vault",
			"ST-x",
			"--only",
			"INV-1, INV-4",
			"--allow-vault",
		]);
		expect(args.vault).toBe("ST-x");
		expect(args.only).toEqual(["INV-1", "INV-4"]);
		expect(args.allowVault).toBe(true);
	});
	it("defaults: no vault, no filter, no override", () => {
		const args = parseArgs([]);
		expect(args).toEqual({ vault: null, only: null, allowVault: false });
	});
});

describe("formatReport", () => {
	const results: InvariantResult[] = [
		{ id: "INV-1", name: "A", guards: "x", status: "pass", detail: "ok" },
		{ id: "INV-2", name: "B", guards: "y", status: "fail", detail: "bad" },
		{ id: "INV-5", name: "C", guards: "z", status: "todo", detail: "later" },
	];
	it("summarizes counts", () => {
		const out = formatReport(results);
		expect(out).toContain("1 pass, 1 fail, 0 skip, 1 todo (of 3)");
	});
	it("carries each invariant id and detail", () => {
		const out = formatReport(results);
		expect(out).toContain("INV-2");
		expect(out).toContain("bad");
	});
});
