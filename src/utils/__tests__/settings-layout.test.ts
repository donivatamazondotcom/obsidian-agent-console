import { describe, it, expect } from "vitest";
import { deriveImportPlacement } from "../settings-layout";

/**
 * T5 (D5) — Import placement resolver. The settings pane reads this single
 * pure function at both call sites (Top matter / Advanced) so the placement
 * can never disagree between them. See [[Agent Console Settings Pane
 * Reorganization]] § OQ1 / D5.
 */
describe("deriveImportPlacement (T5 / D5)", () => {
	it("places Import in Top matter on a fresh / un-configured install", () => {
		expect(deriveImportPlacement(false)).toBe("top-matter");
	});

	it("moves Import to Advanced once the setup latch has tripped", () => {
		expect(deriveImportPlacement(true)).toBe("advanced");
	});

	it("is total — every boolean maps to exactly one known placement", () => {
		for (const configured of [true, false]) {
			expect(["top-matter", "advanced"]).toContain(
				deriveImportPlacement(configured),
			);
		}
	});
});
