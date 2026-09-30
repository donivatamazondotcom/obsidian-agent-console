/**
 * Plugin self-update check (is there a newer Agent Console release?).
 *
 * Distinct from `update-checker.ts`, which checks the *agent's* npm package.
 *
 * - Stable users: compare with the latest stable release.
 * - Prerelease users: compare with both latest stable and latest prerelease,
 *   preferring the stable version in the notice.
 * - The GitHub result is cached in data.json across loads; see
 *   resolvers/update-check-decision.ts.
 */
import * as semver from "semver";
import { t } from "../i18n";
import {
	decideUpdateCheck,
	type PluginUpdateCache,
} from "../resolvers/update-check-decision";

export interface PluginUpdateCheckDeps {
	/** Installed plugin version (manifest.version). */
	currentVersion: () => string;
	/** Latest stable release version, or null if unknown. */
	fetchLatestStable: () => Promise<string | null>;
	/** Latest prerelease version, or null if none. */
	fetchLatestPrerelease: () => Promise<string | null>;
	/** Show the user-facing "update available" notice. */
	notify: (message: string) => void;
	/** Clock (epoch ms). */
	now: () => number;
	/** Read the saved result (data.json `pluginUpdateCheck`). */
	loadCache: () => PluginUpdateCache | undefined;
	/** Persist the result through the settings single writer. */
	saveCache: (cache: PluginUpdateCache) => Promise<void>;
	/** Log a non-fatal problem (failed fetch, failed save). */
	warn: (message: string, error: unknown) => void;
}

/** The newest version worth telling the user about, or null. */
function newerVersion(
	currentVersion: string,
	isPrerelease: boolean,
	latestStable: string | null,
	latestPrerelease: string | null,
): string | null {
	if (latestStable && semver.gt(latestStable, currentVersion)) {
		// Prefer the stable version in the notice when both are newer.
		return latestStable;
	}
	if (
		isPrerelease &&
		latestPrerelease &&
		semver.gt(latestPrerelease, currentVersion)
	) {
		return latestPrerelease;
	}
	return null;
}

async function save(
	deps: PluginUpdateCheckDeps,
	cache: PluginUpdateCache,
): Promise<void> {
	try {
		await deps.saveCache(cache);
	} catch (error) {
		deps.warn("Failed to save the plugin update check result:", error);
	}
}

async function runCheck(deps: PluginUpdateCheckDeps): Promise<boolean> {
	const raw = deps.currentVersion();
	const currentVersion = semver.clean(raw) || raw;
	const isPrerelease = semver.prerelease(currentVersion) !== null;
	const cache = deps.loadCache();
	const now = deps.now();

	const decision = decideUpdateCheck({ cache, now, isPrerelease });
	let latestStable: string | null;
	let latestPrerelease: string | null;

	switch (decision.kind) {
		case "use-cache":
			latestStable = decision.latestStable;
			latestPrerelease = decision.latestPrerelease;
			break;
		case "backoff":
			return false;
		case "fetch":
			try {
				[latestStable, latestPrerelease] = await Promise.all([
					deps.fetchLatestStable(),
					isPrerelease
						? deps.fetchLatestPrerelease()
						: Promise.resolve(null),
				]);
			} catch (error) {
				deps.warn("Plugin update check failed:", error);
				await save(deps, {
					...(cache ?? { checkedAt: 0, latestStable: null }),
					failedAt: now,
				});
				return false;
			}
			await save(deps, {
				checkedAt: now,
				latestStable,
				...(isPrerelease ? { latestPrerelease } : {}),
			});
			break;
	}

	const newest = newerVersion(
		currentVersion,
		isPrerelease,
		latestStable,
		latestPrerelease,
	);
	if (!newest) return false;
	deps.notify(t("notices.updateAvailable", { version: newest }));
	return true;
}

/**
 * Build the plugin's update check. The returned function runs the check at
 * most once per plugin load: every chat tab calls it on mount, and all tabs
 * share one promise — one decision, at most one GitHub fetch, one notice
 * (I206). Across loads, the saved result is reused while fresh and a failure
 * backs off (see resolvers/update-check-decision.ts). The check never
 * rejects; failures are logged via `warn` and resolve to false.
 */
export function createPluginUpdateCheck(
	deps: PluginUpdateCheckDeps,
): () => Promise<boolean> {
	let inFlight: Promise<boolean> | null = null;
	return () => {
		inFlight ??= runCheck(deps);
		return inFlight;
	};
}
