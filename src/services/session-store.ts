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
 * an independent concern and stay fire-and-forget in the caller. Fork/delete
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

/**
 * Minimal persistence port the SessionStore owns. A subset of ISettingsAccess
 * so the owner can be unit-tested against an in-memory fake.
 *
 * - `getSavedSessions()` returns the live snapshot (synchronously reflects the
 *   most recent committed `saveSession`).
 * - `saveSession(info)` upserts one record by sessionId and persists.
 */
export interface SessionStorePort {
	getSavedSessions(): SavedSessionInfo[];
	saveSession(info: SavedSessionInfo): Promise<void>;
}

export class SessionStore {
	private queue: Promise<void> = Promise.resolve();

	constructor(private readonly port: SessionStorePort) {}

	/**
	 * Run a write task serialized behind every prior task. Chaining on the
	 * queue guarantees each task's read-modify-write observes the previous
	 * task's committed result — no stale-snapshot clobber. The internal chain
	 * never rejects (a failed task does not stall the queue); the caller still
	 * sees its own task's rejection via the returned promise.
	 */
	private enqueue(task: () => Promise<void>): Promise<void> {
		const run = this.queue.then(task, task);
		this.queue = run.catch(() => {});
		return run;
	}

	/**
	 * Persist the savedSessions metadata for a turn (debounced + turn-end).
	 *
	 * Reads the latest snapshot inside the serialized critical section and
	 * resolves the title via `resolveSessionMetadataWrite`: a carried
	 * `suggestedTitle` wins; otherwise the existing title is preserved; a brand
	 * new record falls back to the first-message title. Creates the entry when
	 * none exists so a transcript-on-disk session is never orphaned (I58).
	 */
	recordTurnSave(params: {
		sessionId: string;
		agentId: string;
		cwd: string;
		messages: ChatMessage[];
		suggestedTitle?: string | null;
		now?: string;
	}): Promise<void> {
		return this.enqueue(async () => {
			if (
				!params.sessionId ||
				!params.agentId ||
				params.messages.length === 0
			) {
				return;
			}
			const existing = this.port
				.getSavedSessions()
				.find((s) => s.sessionId === params.sessionId);
			const write = resolveSessionMetadataWrite(existing, {
				sessionId: params.sessionId,
				agentId: params.agentId,
				cwd: params.cwd,
				messages: params.messages,
				now: params.now ?? new Date().toISOString(),
				suggestedTitle: params.suggestedTitle ?? null,
			});
			if (write) await this.port.saveSession(write);
		});
	}

	/**
	 * Apply a resolved AI-suggested title to the session-history record
	 * (replaces the racing `useTitleHistorySync` hook). Reads the latest
	 * snapshot inside the serialized critical section; de-dupes a no-op write.
	 * Creates the record if it doesn't exist yet so an early-resolving title is
	 * not lost when the first save hasn't landed.
	 */
	applySuggestedTitle(params: {
		sessionId: string;
		agentId: string;
		cwd: string;
		suggestedTitle: string;
		now?: string;
	}): Promise<void> {
		return this.enqueue(async () => {
			const title = params.suggestedTitle?.trim();
			if (!params.sessionId || !params.agentId || !title) return;
			const existing = this.port
				.getSavedSessions()
				.find((s) => s.sessionId === params.sessionId);
			const resolved = deriveSessionRecordTitle({
				existing,
				suggestedTitle: title,
			});
			const now = params.now ?? new Date().toISOString();
			if (existing) {
				if (existing.title === resolved) return; // de-dupe
				await this.port.saveSession({
					...existing,
					title: resolved,
					updatedAt: now,
				});
			} else {
				await this.port.saveSession({
					sessionId: params.sessionId,
					agentId: params.agentId,
					cwd: params.cwd,
					title: resolved,
					createdAt: now,
					updatedAt: now,
				});
			}
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
	 * - existing record → overwrite `title`, bump `updatedAt` (de-dupes a no-op).
	 * - no record + `createIfMissing` → create one (history-modal rename of an
	 *   agent-side-only session; fork-branch create). Needs `agentId`/`cwd`.
	 * - no record + !createIfMissing → no-op (a tab whose session is not in
	 *   history — nothing to sync; preserves the `resolveRenamedSessionWrite`
	 *   skip-if-missing contract).
	 */
	renameSession(params: {
		sessionId: string;
		agentId: string;
		cwd: string;
		title: string;
		createIfMissing: boolean;
		now?: string;
	}): Promise<void> {
		return this.enqueue(async () => {
			const title = params.title?.trim();
			if (!params.sessionId || !title) return;
			const now = params.now ?? new Date().toISOString();
			const existing = this.port
				.getSavedSessions()
				.find((s) => s.sessionId === params.sessionId);
			if (existing) {
				if (existing.title === title) return; // de-dupe no-op
				await this.port.saveSession({
					...existing,
					title,
					updatedAt: now,
				});
			} else if (params.createIfMissing && params.agentId) {
				await this.port.saveSession({
					sessionId: params.sessionId,
					agentId: params.agentId,
					cwd: params.cwd,
					title,
					createdAt: now,
					updatedAt: now,
				});
			}
		});
	}

	/**
	 * Persist first-message metadata for a brand-new session through the single
	 * serialized writer (replaces the direct `saveSessionLocally`
	 * `settingsService.saveSession`).
	 *
	 * The first-message title is a FALLBACK, never an override: if a record
	 * already exists (an AI title or rename resolved before the first-message
	 * save landed) its title is preserved and only `updatedAt` is bumped. This
	 * is the existing-title > first-message branch of `deriveSessionRecordTitle`
	 * applied inside the critical section, so a concurrent higher-precedence
	 * write is never clobbered — the exact race the direct write caused.
	 */
	recordFirstMessage(params: {
		sessionId: string;
		agentId: string;
		cwd: string;
		firstMessageTitle: string;
		now?: string;
	}): Promise<void> {
		return this.enqueue(async () => {
			const fallback = params.firstMessageTitle?.trim();
			if (!params.sessionId || !params.agentId || !fallback) return;
			const now = params.now ?? new Date().toISOString();
			const existing = this.port
				.getSavedSessions()
				.find((s) => s.sessionId === params.sessionId);
			if (existing) {
				// Preserve the existing (AI / manual / fork) title; bump only
				// recency. Never downgrade to the first-message text.
				if (existing.updatedAt === now) return; // de-dupe
				await this.port.saveSession({ ...existing, updatedAt: now });
			} else {
				await this.port.saveSession({
					sessionId: params.sessionId,
					agentId: params.agentId,
					cwd: params.cwd,
					title: fallback,
					createdAt: now,
					updatedAt: now,
				});
			}
		});
	}
}
