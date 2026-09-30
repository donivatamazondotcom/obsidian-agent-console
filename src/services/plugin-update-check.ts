/**
 * Plugin self-update check (is there a newer Agent Console release?).
 *
 * Distinct from `update-checker.ts`, which checks the *agent's* npm package.
 *
 * - Stable users: compare with the latest stable release.
 * - Prerelease users: compare with both latest stable and latest prerelease,
 *   preferring the stable version in the notice.
 */
import * as semver from "semver";
import { t } from "../i18n";

export interface PluginUpdateCheckDeps {
	/** Installed plugin version (manifest.version). */
	currentVersion: () => string;
	/** Latest stable release version, or null if unknown. */
	fetchLatestStable: () => Promise<string | null>;
	/** Latest prerelease version, or null if none. */
	fetchLatestPrerelease: () => Promise<string | null>;
	/** Show the user-facing "update available" notice. */
	notify: (message: string) => void;
}

async function runCheck(deps: PluginUpdateCheckDeps): Promise<boolean> {
	const raw = deps.currentVersion();
	const currentVersion = semver.clean(raw) || raw;
	const isCurrentPrerelease = semver.prerelease(currentVersion) !== null;

	if (isCurrentPrerelease) {
		const [latestStable, latestPrerelease] = await Promise.all([
			deps.fetchLatestStable(),
			deps.fetchLatestPrerelease(),
		]);

		const hasNewerStable =
			latestStable && semver.gt(latestStable, currentVersion);
		const hasNewerPrerelease =
			latestPrerelease && semver.gt(latestPrerelease, currentVersion);

		if (hasNewerStable || hasNewerPrerelease) {
			const newestVersion = hasNewerStable
				? latestStable
				: latestPrerelease;
			deps.notify(
				t("notices.updateAvailable", { version: newestVersion ?? "" }),
			);
			return true;
		}
	} else {
		const latestStable = await deps.fetchLatestStable();
		if (latestStable && semver.gt(latestStable, currentVersion)) {
			deps.notify(
				t("notices.updateAvailable", { version: latestStable }),
			);
			return true;
		}
	}

	return false;
}

/**
 * Build the plugin's update check. The returned function runs the check at
 * most once per plugin load: every chat tab calls it on mount, and all tabs
 * share one in-flight promise — one GitHub fetch, one notice, one answer.
 * A failed check is dropped so a later tab can retry.
 */
export function createPluginUpdateCheck(
	deps: PluginUpdateCheckDeps,
): () => Promise<boolean> {
	let inFlight: Promise<boolean> | null = null;
	return () => {
		if (!inFlight) {
			inFlight = runCheck(deps).catch((error: unknown) => {
				inFlight = null;
				throw error;
			});
		}
		return inFlight;
	};
}
