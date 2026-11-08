/**
 * SessionStore — the single writer of record for `savedSessions` metadata.
 *
 * I114 / [[SessionStore Single-Writer]]. The `savedSessions` snapshot was
 * written by three async writers that each did a read-modify-write on the whole
 * array: the debounced incremental save (`useDebouncedSessionSave`), the
 * turn-end save, and the AI-title write (formerly `useTitleHistorySync`).
 * Because each read a snapshot, computed a full record, and wrote it back
 * wholesale, a writer holding a STALE snapshot overwrote a concurrent writer's
 * change — last-writer-wins by timing dropped the resolved AI title back to the
 * first-message text.
 *
 * This owner serializes every metadata/title write through one async-mutex
 * queue and re-reads the latest committed snapshot INSIDE the critical section,
 * then consults the single title-precedence resolver
 * (`deriveSessionRecordTitle`). No writer can act on a stale read, so the AI
 * title survives regardless of save ordering. Same construction as
 * `queue-orchestration-reducer.ts` — fold scattered writers into one owner so
 * the wrong write is impossible by construction.
 *
 * Scope: the `savedSessions` metadata/title array only (the path the three
 * racing writers touch). Per-session message FILES (`sessions/{id}.json`) are
 * written by the caller (`useSessionHistory.saveSessionMessages`), which
 * enqueues the turn save only after the file lands, so a record never exists
 * without its transcript (I295). Fork/delete
 * are not part of the title race and remain on the existing serialized
 * `saveSession`/`deleteSession` (both already guarded by SessionStorage's
 * sessionLock).
 */

import type { ChatMessage } from "../types/chat";
import type { SavedSessionInfo } from "../types/session";
import {
	deriveSessionRecordTitle,
	resolveSessionMetadataWrite,
} from "./session-metadata";
import { findSessionRecord, newRecordId } from "./session-record";

/**
 * Minimal persistence port the SessionStore owns. A subset of ISettingsAccess
 * so the owner can be unit-tested against an in-memory fake.
 *
 * - `getSavedSessions()` returns the live snapshot (synchronously reflects the
 *   most recent committed `saveSession`).
 * - `saveSession(info)` upserts one record by `recordId` (I269) and persists.
 *   It may reject a record that would break the store's invariants.
 */
export interface SessionStorePort {
	getSavedSessions(): SavedSessionInfo[];
	saveSession(info: SavedSessionInfo): Promise<void>;
}

/**
 * Which record a write targets (I269). `recordId` is the tab's bound record,
 * when it has one. Without one — or when the bound record no longer exists —
 * the write adopts the record whose `sessionId` matches. Only when neither
 * matches does a create path mint a record, under the bound id if there is
 * one, else a fresh id.
 */
export interface RecordTarget {
	recordId?: string | null;
	sessionId: string;
}

export class SessionStore {
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private readonly port: SessionStorePort) {}

	/**
	 * Run a write task serialized behind every prior task. Chaining on the
	 * queue guarantees each task's read-modify-write observes the previous
	 * task's committed result — no stale-snapshot clobber. The internal chain
	 * never rejects (a failed task does not stall the queue); the caller still
	 * sees its own task's rejection via the returned promise.
	 */
	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		const run = this.queue.then(task, task);
		this.queue = run.catch(() => {});
		return run;
	}

	/** The record a write targets, read inside the critical section. */
	private find(target: RecordTarget): SavedSessionInfo | undefined {
		const all = this.port.getSavedSessions();
		return (
			(target.recordId
				? findSessionRecord(all, { by: "recordId", id: target.recordId })
				: undefined) ??
			findSessionRecord(all, { by: "sessionId", id: target.sessionId })
		);
	}

	/**
	 * Persist the savedSessions metadata for a turn (debounced + turn-end).
	 *
	 * Reads the latest snapshot inside the serialized critical section and
	 * resolves the title via `resolveSessionMetadataWrite`: a carried
	 * `suggestedTitle` wins; otherwise the existing title is preserved; a brand
	 * new record falls back to the first-message title. Creates the entry when
	 * none exists so a transcript-on-disk session is never orphaned (I58).
	 *
	 * The turn save is one of two writers that move a record's identity
	 * (`sessionId`, `agentId`, `kiroEngine`) to the tab's current agent session
	 * (I269); the other is `rebindSession`. Resolves to the record id written.
	 */
	recordTurnSave(
		params: RecordTarget & {
			agentId: string;
			cwd: string;
			messages: ChatMessage[];
			suggestedTitle?: string | null;
			/** Agent's own title, used only when the record is created (I223). */
			seedTitle?: string | null;
			/** Engine this turn ran on (D2). Absent keeps the stored engine. */
			kiroEngine?: "v2" | "v3";
			now?: string;
		},
	): Promise<string | null> {
		return this.enqueue(async () => {
			if (
				!params.sessionId ||
				!params.agentId ||
				params.messages.length === 0
			) {
				return null;
			}
			const existing = this.find(params);
			const recordId =
				existing?.recordId ?? params.recordId ?? newRecordId();
			const write = resolveSessionMetadataWrite(existing, {
				recordId,
				sessionId: params.sessionId,
				agentId: params.agentId,
				cwd: params.cwd,
				messages: params.messages,
				now: params.now ?? new Date().toISOString(),
				suggestedTitle: params.suggestedTitle ?? null,
				seedTitle: params.seedTitle ?? null,
				kiroEngine: params.kiroEngine,
			});
			if (write) await this.port.saveSession(write);
			return recordId;
		});
	}

	/**
	 * Move a record to the tab's new agent session after a fallback (I269),
	 * before the tab goes ready. Never creates a record (decision a): with no
	 * bound record there is nothing to move. Resolves to the record id moved,
	 * or null.
	 */
	rebindSession(params: {
		recordId: string | null | undefined;
		sessionId: string;
		kiroEngine?: "v2" | "v3";
		now?: string;
	}): Promise<string | null> {
		return this.enqueue(async () => {
			if (!params.recordId || !params.sessionId) return null;
			const existing = findSessionRecord(this.port.getSavedSessions(), {
				by: "recordId",
				id: params.recordId,
			});
			if (!existing) return null;
			if (
				existing.sessionId === params.sessionId &&
				(!params.kiroEngine || existing.kiroEngine === params.kiroEngine)
			) {
				return existing.recordId;
			}
			await this.port.saveSession({
				...existing,
				sessionId: params.sessionId,
				...(params.kiroEngine ? { kiroEngine: params.kiroEngine } : {}),
			});
			return existing.recordId;
		});
	}

	/**
	 * Apply a resolved AI-suggested title to the session-history record
	 * (replaces the racing `useTitleHistorySync` hook). Reads the latest
	 * snapshot inside the serialized critical section; de-dupes a no-op write.
	 * Creates the record if it doesn't exist yet so an early-resolving title is
	 * not lost when the first save hasn't landed. Changes only the title and
	 * recency of an existing record (I269).
	 */
	applySuggestedTitle(
		params: RecordTarget & {
			agentId: string;
			cwd: string;
			suggestedTitle: string;
			now?: string;
		},
	): Promise<string | null> {
		return this.enqueue(async () => {
			const title = params.suggestedTitle?.trim();
			if (!params.sessionId || !params.agentId || !title) return null;
			const existing = this.find(params);
			const resolved = deriveSessionRecordTitle({
				existing,
				suggestedTitle: title,
			});
			const now = params.now ?? new Date().toISOString();
			if (existing) {
				if (existing.title === resolved) return existing.recordId; // de-dupe
				await this.port.saveSession({
					...existing,
					title: resolved,
					updatedAt: now,
				});
				return existing.recordId;
			}
			const recordId = params.recordId ?? newRecordId();
			await this.port.saveSession({
				recordId,
				sessionId: params.sessionId,
				agentId: params.agentId,
				cwd: params.cwd,
				title: resolved,
				createdAt: now,
				updatedAt: now,
			});
			return recordId;
		});
	}

	/**
	 * Apply an EXPLICIT title (a user rename or a fork-branch title) to the
	 * session-history record through the single serialized writer.
	 *
	 * Unlike `recordTurnSave` / `recordFirstMessage` — where the title is a
	 * fallback that yields to an existing title — a rename/fork title is an
	 * explicit user-intent write and therefore WINS: it overwrites whatever is
	 * currently persisted. Routing it through the same queue as the turn-end /
	 * first-message / AI-title writers is what closes the stale-snapshot
	 * clobber a direct `settingsService.saveSession` caused (the I121 fork race;
	 * the history-modal and tab renames racing a concurrent turn-end save).
	 *
	 * Read-modify-write happens INSIDE the serialized critical section:
	 * - existing record → overwrite `title`, bump `updatedAt` (de-dupes a
	 *   no-op). Never touches its agent or session id (I269): a history-modal
	 *   rename can target another agent's row.
	 * - no record + `createIfMissing` → create one (history-modal rename of an
	 *   agent-side-only session; fork-branch create). Needs `agentId`/`cwd`.
	 * - no record + !createIfMissing → no-op (a tab whose session is not in
	 *   history — nothing to sync; preserves the `resolveRenamedSessionWrite`
	 *   skip-if-missing contract).
	 */
	renameSession(
		params: RecordTarget & {
			agentId: string;
			cwd: string;
			title: string;
			createIfMissing: boolean;
			now?: string;
		},
	): Promise<string | null> {
		return this.enqueue(async () => {
			const title = params.title?.trim();
			if (!params.sessionId || !title) return null;
			const now = params.now ?? new Date().toISOString();
			const existing = this.find(params);
			if (existing) {
				if (existing.title === title) return existing.recordId; // de-dupe no-op
				await this.port.saveSession({
					...existing,
					title,
					updatedAt: now,
				});
				return existing.recordId;
			}
			if (params.createIfMissing && params.agentId) {
				const recordId = params.recordId ?? newRecordId();
				await this.port.saveSession({
					recordId,
					sessionId: params.sessionId,
					agentId: params.agentId,
					cwd: params.cwd,
					title,
					createdAt: now,
					updatedAt: now,
				});
				return recordId;
			}
			return null;
		});
	}

	/**
	 * Bump an existing record's recency after its first message, through the
	 * single serialized writer. The existing (AI / manual / fork) title is
	 * preserved; the first-message text is never written over it.
	 *
	 * Never creates a record (I295, [[Session History Invariants]] invariant
	 * 1): a record is created only by `recordTurnSave`, which the caller runs
	 * after the transcript file lands. A first-message save with no record
	 * (the tab closed before the message reached state, or the turn save
	 * hasn't run) writes nothing and resolves to null.
	 */
	recordFirstMessage(
		params: RecordTarget & {
			agentId: string;
			cwd: string;
			firstMessageTitle: string;
			now?: string;
		},
	): Promise<string | null> {
		return this.enqueue(async () => {
			const fallback = params.firstMessageTitle?.trim();
			if (!params.sessionId || !params.agentId || !fallback) return null;
			const now = params.now ?? new Date().toISOString();
			const existing = this.find(params);
			if (!existing) return null;
			// Preserve the existing (AI / manual / fork) title; bump only
			// recency. Never downgrade to the first-message text.
			if (existing.updatedAt === now) return existing.recordId; // de-dupe
			await this.port.saveSession({ ...existing, updatedAt: now });
			return existing.recordId;
		});
	}
}
