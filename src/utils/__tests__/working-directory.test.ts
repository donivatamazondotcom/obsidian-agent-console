import { describe, it, expect } from "vitest";
import { resolveDefaultWorkingDirectory } from "../working-directory";

const VAULT = "/Users/me/vault";

describe("resolveDefaultWorkingDirectory", () => {
	it("returns vault root for an empty value (default, not a fallback)", () => {
		const r = resolveDefaultWorkingDirectory("", VAULT, () => true);
		expect(r).toEqual({ dir: VAULT, fellBack: false });
	});

	it("treats a blank/whitespace value as empty → vault root, no fallback", () => {
		const r = resolveDefaultWorkingDirectory("   ", VAULT, () => true);
		expect(r).toEqual({ dir: VAULT, fellBack: false });
	});

	it("uses an absolute path that exists as a directory", () => {
		const r = resolveDefaultWorkingDirectory(
			"/Users/me/repo",
			VAULT,
			(p) => p === "/Users/me/repo",
		);
		expect(r).toEqual({ dir: "/Users/me/repo", fellBack: false });
	});

	it("falls back to vault root for a non-absolute path", () => {
		const r = resolveDefaultWorkingDirectory("repo/sub", VAULT, () => true);
		expect(r).toEqual({ dir: VAULT, fellBack: true });
	});

	it("falls back to vault root for an absolute path that does not exist", () => {
		const r = resolveDefaultWorkingDirectory(
			"/Users/me/missing",
			VAULT,
			() => false,
		);
		expect(r).toEqual({ dir: VAULT, fellBack: true });
	});

	it("trims surrounding whitespace before validating", () => {
		const r = resolveDefaultWorkingDirectory(
			"  /Users/me/repo  ",
			VAULT,
			(p) => p === "/Users/me/repo",
		);
		expect(r).toEqual({ dir: "/Users/me/repo", fellBack: false });
	});
});
