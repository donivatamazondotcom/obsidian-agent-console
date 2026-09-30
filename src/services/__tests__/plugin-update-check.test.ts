/**
 * Plugin update check — once per plugin load (I206), and cached across loads
 * ([[Cache the plugin update check across reloads]]).
 *
 * Every chat tab calls `plugin.checkForUpdates()` on mount and all tabs stay
 * mounted, so within a load the tabs must share one check (I206). Across
 * loads, a result under 6 h old is reused so a relaunch doesn't call GitHub,
 * and a failed fetch backs off for 1 h instead of retrying into a rate limit.
 *
 * `plugin.checkForUpdates()` is a one-line delegate to the function built by
 * `createPluginUpdateCheck`, so this enters at the seam every tab calls (R2)
 * and asserts outcomes: notices shown, fetch count, and the saved cache (R3).
 * A "reload" is a fresh `createPluginUpdateCheck` over the same saved store —
 * the mount→persist→remount lifecycle. Only the network, Notice, clock, and
 * settings ports are faked (R4).
 */
import { describe, expect, it, vi } from "vitest";
import {
	createPluginUpdateCheck,
	type PluginUpdateCheckDeps,
} from "../plugin-update-check";
import type { PluginUpdateCache } from "../../resolvers/update-check-decision";

const HOUR = 60 * 60 * 1000;
const T0 = 1_800_000_000_000;

/** A saved-settings store shared across simulated plugin loads. */
function makeStore(initial?: PluginUpdateCache) {
	let saved = initial;
	return {
		get: () => saved,
		load: () => saved,
		save: vi.fn((c: PluginUpdateCache) => {
			saved = c;
			return Promise.resolve();
		}),
	};
}

type Store = ReturnType<typeof makeStore>;

function load(
	store: Store,
	overrides: Partial<PluginUpdateCheckDeps> = {},
	now = T0,
) {
	const notify = vi.fn();
	const fetchLatestStable = vi.fn().mockResolvedValue("2.5.0");
	const fetchLatestPrerelease = vi.fn().mockResolvedValue(null);
	const deps: PluginUpdateCheckDeps = {
		currentVersion: () => "2.4.0",
		fetchLatestStable,
		fetchLatestPrerelease,
		notify,
		now: () => now,
		loadCache: store.load,
		saveCache: store.save,
		warn: vi.fn(),
		...overrides,
	};
	return { check: createPluginUpdateCheck(deps), deps, notify };
}

describe("plugin update check — once per plugin load (I206)", () => {
	it("20 tabs mounting → one GitHub fetch, one notice, every tab sees the update", async () => {
		const { check, deps, notify } = load(makeStore());

		const results = await Promise.all(
			Array.from({ length: 20 }, () => check()),
		);

		expect(results).toEqual(Array(20).fill(true));
		expect(deps.fetchLatestStable).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledTimes(1);
	});

	it("a tab opened later reuses the result — no second fetch or notice", async () => {
		const { check, deps, notify } = load(makeStore());

		await check();
		const later = await check();

		expect(later).toBe(true);
		expect(deps.fetchLatestStable).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledTimes(1);
	});

	it("no update → no notice, still one fetch across tabs", async () => {
		const { check, deps, notify } = load(makeStore(), {
			fetchLatestStable: vi.fn().mockResolvedValue("2.4.0"),
		});

		const results = await Promise.all(
			Array.from({ length: 5 }, () => check()),
		);

		expect(results).toEqual(Array(5).fill(false));
		expect(deps.fetchLatestStable).toHaveBeenCalledTimes(1);
		expect(notify).not.toHaveBeenCalled();
	});

	it("prerelease user: stable + prerelease fetched once each across tabs", async () => {
		const { check, deps, notify } = load(makeStore(), {
			currentVersion: () => "2.5.0-beta.1",
			fetchLatestStable: vi.fn().mockResolvedValue("2.4.0"),
			fetchLatestPrerelease: vi.fn().mockResolvedValue("2.5.0-beta.2"),
		});

		await Promise.all(Array.from({ length: 10 }, () => check()));

		expect(deps.fetchLatestStable).toHaveBeenCalledTimes(1);
		expect(deps.fetchLatestPrerelease).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify.mock.calls[0][0]).toContain("2.5.0-beta.2");
	});

	it("a failed fetch resolves false for every tab — one fetch, no notice, one warning", async () => {
		const warn = vi.fn();
		const { check, deps, notify } = load(makeStore(), {
			fetchLatestStable: vi.fn().mockRejectedValue(new Error("403")),
			warn,
		});

		const results = await Promise.all(
			Array.from({ length: 5 }, () => check()),
		);

		expect(results).toEqual(Array(5).fill(false));
		expect(deps.fetchLatestStable).toHaveBeenCalledTimes(1);
		expect(notify).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

describe("plugin update check — cached across reloads", () => {
	it("load 1 fetches and saves; load 2 shows the notice with no fetch", async () => {
		const store = makeStore();

		const first = load(store);
		expect(await first.check()).toBe(true);
		expect(store.get()).toEqual({ checkedAt: T0, latestStable: "2.5.0" });

		const second = load(store, {}, T0 + HOUR);
		expect(await second.check()).toBe(true);
		expect(second.deps.fetchLatestStable).not.toHaveBeenCalled();
		expect(second.notify).toHaveBeenCalledTimes(1);
		expect(second.notify.mock.calls[0][0]).toContain("2.5.0");
	});

	it("after upgrading, the saved result says no update — no notice, no fetch", async () => {
		const store = makeStore({ checkedAt: T0, latestStable: "2.5.0" });

		const { check, deps, notify } = load(
			store,
			{ currentVersion: () => "2.5.0" },
			T0 + HOUR,
		);

		expect(await check()).toBe(false);
		expect(deps.fetchLatestStable).not.toHaveBeenCalled();
		expect(notify).not.toHaveBeenCalled();
	});

	it("a result 6 h old is stale → fetch again and re-save", async () => {
		const store = makeStore({ checkedAt: T0, latestStable: "2.4.0" });
		const later = T0 + 6 * HOUR;

		const { check, deps } = load(
			store,
			{ fetchLatestStable: vi.fn().mockResolvedValue("2.6.0") },
			later,
		);

		expect(await check()).toBe(true);
		expect(deps.fetchLatestStable).toHaveBeenCalledTimes(1);
		expect(store.get()).toEqual({ checkedAt: later, latestStable: "2.6.0" });
	});

	it("a failure saves failedAt and blocks fetching for 1 h, then retries", async () => {
		const store = makeStore({ checkedAt: 0, latestStable: "2.4.0" });

		const failing = load(store, {
			fetchLatestStable: vi.fn().mockRejectedValue(new Error("403")),
		});
		expect(await failing.check()).toBe(false);
		expect(store.get()).toEqual({
			checkedAt: 0,
			latestStable: "2.4.0",
			failedAt: T0,
		});

		const soon = load(store, {}, T0 + HOUR - 1);
		expect(await soon.check()).toBe(false);
		expect(soon.deps.fetchLatestStable).not.toHaveBeenCalled();
		expect(soon.notify).not.toHaveBeenCalled();

		const afterBackoff = load(store, {}, T0 + HOUR);
		expect(await afterBackoff.check()).toBe(true);
		expect(afterBackoff.deps.fetchLatestStable).toHaveBeenCalledTimes(1);
		expect(store.get()).toEqual({
			checkedAt: T0 + HOUR,
			latestStable: "2.5.0",
		});
	});

	it("beta user: the saved prerelease version is reused across a reload", async () => {
		const store = makeStore();
		const beta = {
			currentVersion: () => "2.5.0-beta.1",
			fetchLatestStable: vi.fn().mockResolvedValue("2.4.0"),
			fetchLatestPrerelease: vi.fn().mockResolvedValue("2.5.0-beta.2"),
		};

		await load(store, beta).check();
		expect(store.get()).toEqual({
			checkedAt: T0,
			latestStable: "2.4.0",
			latestPrerelease: "2.5.0-beta.2",
		});

		const second = load(
			store,
			{
				currentVersion: () => "2.5.0-beta.1",
				fetchLatestStable: vi.fn(),
				fetchLatestPrerelease: vi.fn(),
			},
			T0 + HOUR,
		);
		expect(await second.check()).toBe(true);
		expect(second.deps.fetchLatestStable).not.toHaveBeenCalled();
		expect(second.deps.fetchLatestPrerelease).not.toHaveBeenCalled();
	});

	it("a save failure still shows the notice and warns", async () => {
		const warn = vi.fn();
		const store = makeStore();
		store.save.mockRejectedValueOnce(new Error("disk full"));

		const { check, notify } = load(store, { warn });

		expect(await check()).toBe(true);
		expect(notify).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledTimes(1);
	});
});
