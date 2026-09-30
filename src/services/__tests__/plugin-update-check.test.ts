/**
 * Plugin update check runs once per plugin load, not once per tab.
 *
 * Every chat tab's ChatPanel calls `plugin.checkForUpdates()` on mount, and
 * all tabs stay mounted. Before the fix each call hit the GitHub releases API
 * and raised its own "Update available" Notice, so restoring 20 tabs produced
 * 20 toasts (and 20 unauthenticated API calls against a 60/hour limit).
 *
 * `plugin.checkForUpdates()` is a one-line delegate to the function built by
 * `createPluginUpdateCheck`, so this enters at the seam every tab calls (R2)
 * and asserts the user-visible outcome — notices shown — plus fetch count (R3).
 * Only the network and Notice ports are faked (R4).
 */
import { describe, expect, it, vi } from "vitest";
import {
	createPluginUpdateCheck,
	type PluginUpdateCheckDeps,
} from "../plugin-update-check";

function setup(overrides: Partial<PluginUpdateCheckDeps> = {}) {
	const notify = vi.fn();
	const fetchLatestStable = vi.fn().mockResolvedValue("2.5.0");
	const fetchLatestPrerelease = vi.fn().mockResolvedValue(null);
	const deps: PluginUpdateCheckDeps = {
		currentVersion: () => "2.4.0",
		fetchLatestStable,
		fetchLatestPrerelease,
		notify,
		...overrides,
	};
	return { check: createPluginUpdateCheck(deps), deps, notify };
}

describe("plugin update check — once per plugin load", () => {
	it("20 tabs mounting → one GitHub fetch, one notice, every tab sees the update", async () => {
		const { check, deps, notify } = setup();

		const results = await Promise.all(
			Array.from({ length: 20 }, () => check()),
		);

		expect(results).toEqual(Array(20).fill(true));
		expect(deps.fetchLatestStable).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledTimes(1);
	});

	it("a tab opened later reuses the result — no second fetch or notice", async () => {
		const { check, deps, notify } = setup();

		await check();
		const later = await check();

		expect(later).toBe(true);
		expect(deps.fetchLatestStable).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledTimes(1);
	});

	it("no update → no notice, still one fetch across tabs", async () => {
		const { check, deps, notify } = setup({
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
		const { check, deps, notify } = setup({
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

	it("a failed check is not cached — the next tab can retry", async () => {
		const fetchLatestStable = vi
			.fn()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce("2.5.0");
		const { check, notify } = setup({ fetchLatestStable });

		await expect(check()).rejects.toThrow("offline");
		await expect(check()).resolves.toBe(true);
		expect(fetchLatestStable).toHaveBeenCalledTimes(2);
		expect(notify).toHaveBeenCalledTimes(1);
	});
});
