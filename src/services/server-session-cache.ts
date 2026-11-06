/**
 * The server-session cache: the last `session/list` each agent launch
 * returned, so a disconnected tab can show its Agent view (Session History
 * Source Model Decision 1). Keyed by launch (`agentLaunchKey`), never agent
 * id, because one agent id can launch an engine that lists sessions and one
 * that can't (I270).
 *
 * This module is the only reader and writer of `serverSessionCache`. Get the
 * key from `historyLaunchKey` (reading) or `AcpClient.getLaunchKey()`
 * (writing).
 */
import type { AgentSessionMetaCacheEntry } from "../types/session";

type CacheMap = Record<string, AgentSessionMetaCacheEntry>;

/** The cached list for one launch, or null when there is none. */
export function readServerSessionCache(
	settings: { serverSessionCache: CacheMap },
	launchKey: string | null,
): AgentSessionMetaCacheEntry | null {
	if (!launchKey) return null;
	return settings.serverSessionCache[launchKey] ?? null;
}

/** The cache with one launch's entry replaced; other launches unchanged. */
export function withServerSessionCache(
	cache: CacheMap,
	launchKey: string,
	entry: AgentSessionMetaCacheEntry,
): CacheMap {
	return { ...cache, [launchKey]: entry };
}

/**
 * Settings-edge validation: keep only entries shaped like a sync result.
 * Drops and logs the rest; never coerces.
 */
export function normalizeServerSessionCache(
	raw: unknown,
	warn: (message: string) => void,
): CacheMap {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const out: CacheMap = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		const entry = value as { sessions?: unknown; syncedAt?: unknown } | null;
		const valid =
			!!entry &&
			typeof entry === "object" &&
			Array.isArray(entry.sessions) &&
			entry.sessions.every(
				(s) =>
					!!s &&
					typeof s === "object" &&
					typeof (s as { sessionId?: unknown }).sessionId === "string",
			) &&
			typeof entry.syncedAt === "string";
		if (!valid) {
			warn(`Dropping malformed server-session cache entry for "${key}"`);
			continue;
		}
		out[key] = entry as AgentSessionMetaCacheEntry;
	}
	return out;
}
