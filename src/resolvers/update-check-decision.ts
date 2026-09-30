/**
 * `decideUpdateCheck` — whether the plugin's GitHub update check can reuse the
 * result saved in data.json, must wait out a recent failure, or should fetch.
 *
 * WHY THIS EXISTS
 * The check calls the unauthenticated GitHub releases API: 60 calls per hour
 * per IP, shared by every vault and tool on the machine. One call per plugin
 * load (I206) still spent that budget on frequent reloads, and a rate-limited
 * check fails quietly — no notice, no header pill. See
 * [[Cache the plugin update check across reloads]].
 *
 * DESIGN
 * The cache holds facts (the latest release versions), never the verdict
 * ("update available?"). The caller compares versions to the installed one on
 * every load, so upgrading can never leave a stale "update available".
 *
 * Order: a fresh result is used even after a later failure (we have data);
 * otherwise a failure under 1 h ago backs off, per GitHub's guidance to stop
 * requesting while rate-limited; otherwise fetch. A timestamp in the future
 * (clock skew) never counts as fresh or as a recent failure.
 *
 * Pure and total: clock and prerelease status are injected.
 */

/** Saved result of the last plugin update check (data.json `pluginUpdateCheck`). */
export interface PluginUpdateCache {
	/** Epoch ms of the last successful fetch (0 = never). */
	checkedAt: number;
	/** Latest stable release version, or null if GitHub reported none. */
	latestStable: string | null;
	/** Latest prerelease version; undefined = never fetched (stable users). */
	latestPrerelease?: string | null;
	/** Epoch ms of the last failed fetch. */
	failedAt?: number;
}

export const UPDATE_CACHE_FRESH_MS = 6 * 60 * 60 * 1000;
export const UPDATE_BACKOFF_MS = 60 * 60 * 1000;

export type UpdateCheckDecision =
	| {
			kind: "use-cache";
			latestStable: string | null;
			latestPrerelease: string | null;
	  }
	| { kind: "backoff" }
	| { kind: "fetch" };

export interface UpdateCheckInput {
	cache: PluginUpdateCache | undefined;
	now: number;
	/** Whether the installed version is a prerelease (beta user). */
	isPrerelease: boolean;
}

/** `now - at` is in [0, windowMs). Future timestamps are never "within". */
function within(at: number, now: number, windowMs: number): boolean {
	const age = now - at;
	return age >= 0 && age < windowMs;
}

export function decideUpdateCheck(input: UpdateCheckInput): UpdateCheckDecision {
	const { cache, now, isPrerelease } = input;
	if (!cache) return { kind: "fetch" };

	const hasWhatUserNeeds =
		!isPrerelease || cache.latestPrerelease !== undefined;
	if (hasWhatUserNeeds && within(cache.checkedAt, now, UPDATE_CACHE_FRESH_MS)) {
		return {
			kind: "use-cache",
			latestStable: cache.latestStable,
			latestPrerelease: cache.latestPrerelease ?? null,
		};
	}

	if (
		cache.failedAt !== undefined &&
		within(cache.failedAt, now, UPDATE_BACKOFF_MS)
	) {
		return { kind: "backoff" };
	}

	return { kind: "fetch" };
}
