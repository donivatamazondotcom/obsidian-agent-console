/**
 * I202: which saved chats leave the list, and which transcript files are
 * unused.
 *
 * The saved-chat list is capped (Settings → Sessions → Max saved chats).
 * When it is over the cap, the least recently updated chats go first, and a
 * chat a persisted tab uses never goes: evicting it would leave a tab whose
 * history has no record. If every candidate is protected the list stays over
 * the cap until one frees up.
 *
 * `SessionStorage` is the only caller that acts on these decisions; it moves
 * each evicted chat's transcript to the trash in the same locked write.
 *
 * Pure and total; no Obsidian, React or SDK imports.
 */
import type { PerLeafTabState } from "../types/tab";

/** Values offered in the Max saved chats dropdown. `null` is Unlimited. */
export const SAVED_SESSIONS_CAP_OPTIONS = [25, 50, 100, 250, 500] as const;

export const DEFAULT_MAX_SAVED_SESSIONS = 100;

/** A cap in chats, or `null` for unlimited. */
export type SavedSessionsCap = number | null;

/** The cleanup command skips files changed more recently than this. */
export const UNUSED_FILE_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Validate the stored setting. Missing → default; `null` → unlimited; one of
 * the offered values → that value. Anything else falls back to the default
 * and reports `valid: false` so the caller can log it (never coerce silently).
 */
export function parseMaxSavedSessions(raw: unknown): {
	cap: SavedSessionsCap;
	valid: boolean;
} {
	if (raw === undefined) return { cap: DEFAULT_MAX_SAVED_SESSIONS, valid: true };
	if (raw === null) return { cap: null, valid: true };
	if (
		typeof raw === "number" &&
		(SAVED_SESSIONS_CAP_OPTIONS as readonly number[]).includes(raw)
	) {
		return { cap: raw, valid: true };
	}
	return { cap: DEFAULT_MAX_SAVED_SESSIONS, valid: false };
}

interface RetentionRecord {
	sessionId: string;
	updatedAt: string;
}

function updatedMs(record: RetentionRecord): number {
	const ms = Date.parse(record.updatedAt);
	return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Split `sessions` into the records to keep and the ones to evict. Keeps the
 * input order for kept records. Ties on `updatedAt` evict the later list
 * entry first (the old insertion-tail behavior).
 */
export function selectEvictions<T extends RetentionRecord>(
	sessions: readonly T[],
	cap: SavedSessionsCap,
	protectedIds: ReadonlySet<string>,
): { kept: T[]; evicted: T[] } {
	if (cap === null || sessions.length <= cap) {
		return { kept: [...sessions], evicted: [] };
	}
	const excess = sessions.length - cap;
	const candidates = sessions
		.map((record, index) => ({ record, index }))
		.filter(({ record }) => !protectedIds.has(record.sessionId))
		.sort(
			(a, b) =>
				updatedMs(a.record) - updatedMs(b.record) || b.index - a.index,
		)
		.slice(0, excess);
	const evictIndexes = new Set(candidates.map((c) => c.index));
	return {
		kept: sessions.filter((_, i) => !evictIndexes.has(i)),
		evicted: candidates.map((c) => c.record),
	};
}

/** Every session id a persisted tab points at, across all leaves. */
export function tabSessionIds(
	perLeafTabStates: readonly PerLeafTabState[] | undefined,
): Set<string> {
	const ids = new Set<string>();
	for (const leaf of perLeafTabStates ?? []) {
		for (const tab of leaf.tabs) {
			if (tab.sessionId) ids.add(tab.sessionId);
		}
	}
	return ids;
}

/** File name (without `.json`) that storage uses for a session id. */
export function sessionFileStem(sessionId: string): string {
	return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Plain size for notices: "512 KB", "3.4 MB", "1.2 GB". */
export function formatSize(bytes: number): string {
	const kb = bytes / 1024;
	if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
	const mb = kb / 1024;
	if (mb < 1024) return `${mb.toFixed(1)} MB`;
	return `${(mb / 1024).toFixed(1)} GB`;
}

export interface SessionFileInfo {
	stem: string;
	mtime: number;
	size: number;
}

/**
 * Transcript files the cleanup command may move to the trash: no saved chat
 * or persisted tab refers to them, and they haven't changed within
 * `minAgeMs` (a transcript can be written just before its record lands).
 */
export function selectUnusedSessionFiles(input: {
	files: readonly SessionFileInfo[];
	referencedStems: ReadonlySet<string>;
	now: number;
	minAgeMs: number;
}): SessionFileInfo[] {
	return input.files.filter(
		(f) =>
			!input.referencedStems.has(f.stem) &&
			input.now - f.mtime >= input.minAgeMs,
	);
}
