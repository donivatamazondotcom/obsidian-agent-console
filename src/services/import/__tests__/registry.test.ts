import { describe, it, expect } from "vitest";
import { firstDetectedSource } from "../registry";
import type { ImportSource } from "../ImportSource";

function fakeSource(id: string, detected: boolean): ImportSource {
	return {
		id,
		displayName: id,
		detect: async () => detected,
		preview: async () => null,
		apply: async () => ({}),
	};
}

describe("firstDetectedSource", () => {
	it("returns the first source that detects", async () => {
		const s = await firstDetectedSource([
			fakeSource("a", false),
			fakeSource("b", true),
			fakeSource("c", true),
		]);
		expect(s?.id).toBe("b");
	});

	it("returns null when none detect", async () => {
		const s = await firstDetectedSource([
			fakeSource("a", false),
			fakeSource("b", false),
		]);
		expect(s).toBeNull();
	});

	it("returns null for an empty source list", async () => {
		expect(await firstDetectedSource([])).toBeNull();
	});
});
