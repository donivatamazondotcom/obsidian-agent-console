/**
 * Tests for output path derivation.
 *
 * The driver writes captured + cropped screenshots to
 * `docs/public/images/<name>.webp`. Output path is derived from the
 * manifest entry's `name` field. Pure function — no FS access.
 *
 * TDD layer 1.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { deriveOutputPath } from "../output";

describe("deriveOutputPath", () => {
	it("joins repo root + docs path + <name>.webp", () => {
		const result = deriveOutputPath({ name: "ribbon-icon" }, "/repo");
		expect(result).toBe(
			path.join("/repo", "docs", "public", "images", "ribbon-icon.webp"),
		);
	});

	it("rejects empty name", () => {
		expect(() => deriveOutputPath({ name: "" }, "/repo")).toThrow(/empty/);
	});

	it("rejects names with path separators", () => {
		expect(() =>
			deriveOutputPath({ name: "subdir/ribbon" }, "/repo"),
		).toThrow(/separator/i);
	});

	it("rejects names with traversal sequences", () => {
		expect(() =>
			deriveOutputPath({ name: "../etc-passwd" }, "/repo"),
		).toThrow(/traversal|separator/i);
	});

	it("rejects absolute paths", () => {
		expect(() =>
			deriveOutputPath({ name: "/etc/passwd" }, "/repo"),
		).toThrow(/absolute|separator/i);
	});

	it("accepts hyphenated and underscored names", () => {
		expect(deriveOutputPath({ name: "multi-session" }, "/repo")).toBe(
			path.join(
				"/repo",
				"docs",
				"public",
				"images",
				"multi-session.webp",
			),
		);
		expect(deriveOutputPath({ name: "floating_chat_view" }, "/repo")).toBe(
			path.join(
				"/repo",
				"docs",
				"public",
				"images",
				"floating_chat_view.webp",
			),
		);
	});
});
