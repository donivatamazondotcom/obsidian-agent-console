/**
 * decideUpdateCheck — whether the plugin update check may reuse the saved
 * GitHub result, must wait out a recent failure, or should fetch.
 * Spec: [[Cache the plugin update check across reloads]].
 */
import { describe, expect, it } from "vitest";
import {
	decideUpdateCheck,
	UPDATE_BACKOFF_MS,
	UPDATE_CACHE_FRESH_MS,
	type PluginUpdateCache,
} from "../update-check-decision";

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

function cache(overrides: Partial<PluginUpdateCache> = {}): PluginUpdateCache {
	return { checkedAt: NOW - HOUR, latestStable: "2.5.0", ...overrides };
}

describe("decideUpdateCheck", () => {
	it("pins the windows: 6 h fresh, 1 h backoff", () => {
		expect(UPDATE_CACHE_FRESH_MS).toBe(6 * HOUR);
		expect(UPDATE_BACKOFF_MS).toBe(HOUR);
	});

	it("no saved result → fetch", () => {
		expect(
			decideUpdateCheck({ cache: undefined, now: NOW, isPrerelease: false }),
		).toEqual({ kind: "fetch" });
	});

	it("fresh result → use-cache with the saved versions", () => {
		expect(
			decideUpdateCheck({ cache: cache(), now: NOW, isPrerelease: false }),
		).toEqual({
			kind: "use-cache",
			latestStable: "2.5.0",
			latestPrerelease: null,
		});
	});

	it("just under 6 h old → use-cache; exactly 6 h → fetch", () => {
		const almost = cache({ checkedAt: NOW - UPDATE_CACHE_FRESH_MS + 1 });
		const expired = cache({ checkedAt: NOW - UPDATE_CACHE_FRESH_MS });
		expect(
			decideUpdateCheck({ cache: almost, now: NOW, isPrerelease: false }).kind,
		).toBe("use-cache");
		expect(
			decideUpdateCheck({ cache: expired, now: NOW, isPrerelease: false })
				.kind,
		).toBe("fetch");
	});

	it("checkedAt in the future (clock skew) → treated as stale → fetch", () => {
		expect(
			decideUpdateCheck({
				cache: cache({ checkedAt: NOW + HOUR }),
				now: NOW,
				isPrerelease: false,
			}).kind,
		).toBe("fetch");
	});

	it("beta user with no saved prerelease version → fetch", () => {
		expect(
			decideUpdateCheck({ cache: cache(), now: NOW, isPrerelease: true }).kind,
		).toBe("fetch");
	});

	it("beta user with a saved prerelease version (even null) → use-cache", () => {
		expect(
			decideUpdateCheck({
				cache: cache({ latestPrerelease: "2.5.0-beta.2" }),
				now: NOW,
				isPrerelease: true,
			}),
		).toEqual({
			kind: "use-cache",
			latestStable: "2.5.0",
			latestPrerelease: "2.5.0-beta.2",
		});
		expect(
			decideUpdateCheck({
				cache: cache({ latestPrerelease: null }),
				now: NOW,
				isPrerelease: true,
			}).kind,
		).toBe("use-cache");
	});

	it("stale result + failure under 1 h ago → backoff", () => {
		expect(
			decideUpdateCheck({
				cache: cache({ checkedAt: 0, failedAt: NOW - UPDATE_BACKOFF_MS + 1 }),
				now: NOW,
				isPrerelease: false,
			}),
		).toEqual({ kind: "backoff" });
	});

	it("failure exactly 1 h ago → fetch", () => {
		expect(
			decideUpdateCheck({
				cache: cache({ checkedAt: 0, failedAt: NOW - UPDATE_BACKOFF_MS }),
				now: NOW,
				isPrerelease: false,
			}).kind,
		).toBe("fetch");
	});

	it("failedAt in the future (clock skew) → ignored → fetch", () => {
		expect(
			decideUpdateCheck({
				cache: cache({ checkedAt: 0, failedAt: NOW + HOUR }),
				now: NOW,
				isPrerelease: false,
			}).kind,
		).toBe("fetch");
	});

	it("fresh result wins over a recent failure → use-cache", () => {
		expect(
			decideUpdateCheck({
				cache: cache({ failedAt: NOW - 1000 }),
				now: NOW,
				isPrerelease: false,
			}).kind,
		).toBe("use-cache");
	});
});
