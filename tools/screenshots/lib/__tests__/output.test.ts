/**
 * Tests for output path derivation.
 *
 * The driver writes captured + cropped screenshots to
 * `docs/public/images/<output>`. Output path is derived per manifest
 * entry. Pure function — no FS access.
 *
 * TDD layer 1.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { deriveOutputPath } from "../output";

describe("deriveOutputPath", () => {
	it("joins repo root + docs path + entry output", () => {
		const result = deriveOutputPath(
			{ output: "ribbon-icon.webp" },
			"/repo",
		);
		expect(result).toBe(
			path.join("/repo", "docs", "public", "images", "ribbon-icon.webp"),
		);
	});

	it("rejects absolute paths in entry.output (must be relative)", () => {
		expect(() =>
			deriveOutputPath({ output: "/etc/passwd" }, "/repo"),
		).toThrow(/absolute/);
	});

	it("rejects path traversal via ..", () => {
		expect(() =>
			deriveOutputPath({ output: "../../../etc/passwd" }, "/repo"),
		).toThrow(/traversal|escape/i);
	});

	it("accepts subdirectory paths within docs/public/images", () => {
		const result = deriveOutputPath(
			{ output: "mobile/ribbon.webp" },
			"/repo",
		);
		expect(result).toBe(
			path.join(
				"/repo",
				"docs",
				"public",
				"images",
				"mobile",
				"ribbon.webp",
			),
		);
	});
});
