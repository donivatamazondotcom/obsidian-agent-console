/**
 * Tests for the drop-shadow post-processor.
 *
 * Test contract: tools/screenshots/lib/__tests__/shadow.test.ts.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { addDropShadow } from "../shadow";

describe("addDropShadow", () => {
	// libvips caches metadata by filename; disable it so the post-write
	// re-read below reflects the shadowed file, not the pre-shadow original.
	beforeAll(() => sharp.cache(false));

	it("expands the canvas by 2x margin and stays a valid image", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "shadow-test-"));
		const file = path.join(dir, "img.webp");
		await sharp({
			create: { width: 100, height: 60, channels: 4, background: { r: 20, g: 30, b: 40, alpha: 1 } },
		})
			.webp()
			.toFile(file);

		await addDropShadow(file, { margin: 40, blur: 8 });

		const meta = await sharp(file).metadata();
		expect(meta.width).toBe(180); // 100 + 2*40
		expect(meta.height).toBe(140); // 60 + 2*40
	});

	it("throws when the file has no readable dimensions", async () => {
		await expect(addDropShadow("/nonexistent/missing.webp")).rejects.toThrow();
	});
});
