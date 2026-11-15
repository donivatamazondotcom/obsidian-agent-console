/**
 * Which history record an id refers to (I269). The one lookup every layer
 * uses; `services/session-record.ts` re-exports it. It lives in `utils/` so
 * pure resolvers can use it too ([[Agent Console Chat ID]]).
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
