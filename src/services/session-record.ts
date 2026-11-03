/**
 * Record identity for `savedSessions` (I269).
 *
 * A history record has a plugin-owned `recordId` that never changes, and the
 * agent session id it currently runs as (`sessionId`), which a fallback
 * changes. These pure helpers are the one place that decides which record an
 * id refers to, what a valid record looks like, and how pre-I269 data is
 * migrated. See [[I269 A fallback leaves two history entries for one chat]]
 * and [[Session History Invariants]] invariant 1.
 */

import type { SavedSessionInfo } from "../types/session";

/**
 * Which id a caller holds. An agent session id must only ever be matched
 * against `sessionId`: a migrated record's `recordId` equals the agent id it
 * started with, and that agent session can outlive the rebind (decision b).
 */
export type SessionRecordKey =
	| { by: "sessionId"; id: string }
	| { by: "recordId"; id: string };

export function findSessionRecord(
	records: readonly SavedSessionInfo[],
	key: SessionRecordKey,
): SavedSessionInfo | undefined {
	if (!key.id) return undefined;
	return key.by === "recordId"
		? records.find((r) => r.recordId === key.id)
		: records.find((r) => r.sessionId === key.id);
}

/** A fresh plugin-owned record id. */
export function newRecordId(): string {
	return crypto.randomUUID();
}

/**
 * Violations of one record against the other records (the write-edge check).
 * Checking only the incoming record keeps one bad stored entry from blocking
 * every later write.
 */
export function validateSavedSession(
	record: SavedSessionInfo,
	others: readonly SavedSessionInfo[],
): string[] {
	const out: string[] = [];
	if (!record.recordId) out.push("missing recordId");
	if (!record.sessionId) out.push("missing sessionId");
	if (!record.agentId) out.push("missing agentId");
	if (record.recordId && others.some((o) => o.recordId === record.recordId)) {
		out.push(`duplicate recordId ${record.recordId}`);
	}
	if (
		record.sessionId &&
		others.some((o) => o.sessionId === record.sessionId)
	) {
		out.push(`duplicate sessionId ${record.sessionId}`);
	}
	return out;
}

/** Every violation in a whole array (the restore check and the test oracle). */
export function validateSavedSessions(
	records: readonly SavedSessionInfo[],
): string[] {
	const out: string[] = [];
	records.forEach((r, i) => {
		for (const v of validateSavedSession(r, records.slice(0, i))) {
			if (!out.includes(v)) out.push(v);
		}
	});
	return out;
}

function isNonEmptyString(v: unknown): v is string {
	return typeof v === "string" && v !== "";
}

/**
 * Parse `savedSessions` at the deserialize edge, and run the one-time I269
 * migration. A record without `recordId` gets `recordId = sessionId` (its
 * message file is already named after it, so nothing moves). Idempotent.
 * Writes nothing: the next save persists the result in one `data.json` write.
 *
 * Corrupt entries are dropped and reported through `warn`, never coerced. For
 * a duplicate `recordId` or `sessionId`, the most recently updated record is
 * kept. Message files are never touched.
 */
export function normalizeSavedSessions(
	raw: unknown,
	warn: (message: string, entry: unknown) => void,
): SavedSessionInfo[] {
	if (!Array.isArray(raw)) return [];
	const parsed: SavedSessionInfo[] = [];
	for (const entry of raw as unknown[]) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			warn("[SessionRecord] Dropped a non-object saved session", entry);
			continue;
		}
		const e = entry as Record<string, unknown>;
		if (!isNonEmptyString(e.sessionId) || !isNonEmptyString(e.agentId)) {
			warn("[SessionRecord] Dropped a saved session without ids", entry);
			continue;
		}
		if (e.recordId !== undefined && !isNonEmptyString(e.recordId)) {
			warn("[SessionRecord] Dropped a saved session with a bad recordId", entry);
			continue;
		}
		parsed.push({
			...(e as unknown as SavedSessionInfo),
			recordId: isNonEmptyString(e.recordId) ? e.recordId : e.sessionId,
		});
	}
	// Duplicates: keep the most recently updated, preserving input order.
	const time = (r: SavedSessionInfo) => {
		const t = new Date(r.updatedAt).getTime();
		return Number.isNaN(t) ? 0 : t;
	};
	const winners = new Set<SavedSessionInfo>(parsed);
	for (const key of ["recordId", "sessionId"] as const) {
		const best = new Map<string, SavedSessionInfo>();
		for (const r of parsed) {
			if (!winners.has(r)) continue;
			const prev = best.get(r[key]);
			if (!prev) {
				best.set(r[key], r);
				continue;
			}
			const [keep, drop] = time(r) > time(prev) ? [r, prev] : [prev, r];
			best.set(r[key], keep);
			winners.delete(drop);
			warn(`[SessionRecord] Dropped a duplicate ${key} ${r[key]}`, drop);
		}
	}
	return parsed.filter((r) => winners.has(r));
}
