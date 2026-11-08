/**
 * I300: `lastSeenVersion` crosses the data.json trust boundary.
 *
 * Valid semver → its release core (prerelease dropped); missing → undefined
 * with no log; anything else present → dropped and logged, never coerced.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
	normalizeRawSettings,
	DEFAULT_SETTINGS,
	type MigrateKeyFn,
} from "../settings-normalizer";

const idKey: MigrateKeyFn = (d, _f, c) => c || d;
const load = (raw: Record<string, unknown>) =>
	normalizeRawSettings(raw, DEFAULT_SETTINGS, idKey).lastSeenVersion;

afterEach(() => vi.restoreAllMocks());

function lastSeenWarnings(spy: ReturnType<typeof vi.spyOn>) {
	return spy.mock.calls.filter((c: unknown[]) =>
		c.some((a) => String(a).includes("lastSeenVersion")),
	);
}

describe("I300 lastSeenVersion through normalizeRawSettings", () => {
	it("missing → undefined, no log", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(load({})).toBeUndefined();
		expect(lastSeenWarnings(warn)).toHaveLength(0);
	});

	it("a valid release is kept", () => {
		expect(load({ lastSeenVersion: "2.4.0" })).toBe("2.4.0");
	});

	it("a prerelease is stored as its release core", () => {
		expect(load({ lastSeenVersion: "2.5.0-beta.1" })).toBe("2.5.0");
	});

	it.each([["x"], [7], [""], [null], [{}]])(
		"invalid %j → undefined and logged",
		(bad) => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			expect(load({ lastSeenVersion: bad })).toBeUndefined();
			expect(lastSeenWarnings(warn)).toHaveLength(1);
		},
	);

	it("save → load round trip keeps it", () => {
		const first = normalizeRawSettings(
			{ lastSeenVersion: "2.5.0" },
			DEFAULT_SETTINGS,
			idKey,
		);
		const onDisk = JSON.parse(JSON.stringify(first)) as Record<
			string,
			unknown
		>;
		expect(load(onDisk)).toBe("2.5.0");
	});
});
