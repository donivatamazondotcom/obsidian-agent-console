/**
 * Save-ordering lifecycle test for the SessionStore single writer (I114).
 *
 * Reproduce-first (F03 lesson — a pure-fn test alone is NOT enough): this
 * interleaves the racing writers against a fake persistence port whose
 * `saveSession` is asynchronous and does a wholesale read-modify-write by
 * sessionId (exactly like SessionStorage.saveSession). The fake yields a
 * microtask between its read and its write, so two in-flight writers can
 * interleave — the production stale-snapshot race.
 *
 * Invariant under test: the AI-suggested title must survive ANY interleaving
 * of the messages-only save and the AI-title write.
 *
 *   RED  — with `SessionStore.enqueue` as a passthrough (no serialization),
 *          a concurrent messages-only save clobbers the AI title with the
 *          first-message text (last-writer-wins by timing).
 *   GREEN — once `enqueue` serializes through the async-mutex queue, each
 *          writer re-reads the latest committed snapshot inside its critical
 *          section, so the AI title is never downgraded.
 */

import { describe, it, expect } from "vitest";

import { SessionStore, type SessionStorePort } from "../session-store";
import type { ChatMessage } from "../../types/chat";
import type { SavedSessionInfo } from "../../types/session";

const AGENT = "claude-code-acp";
const CWD = "/vault";
const SID = "s1";
const AI_TITLE = "Explain merge vs rebase";

function userMsg(text: string): ChatMessage {
	return {
		id: "m1",
		role: "user",
		content: [{ type: "text", text }],
		timestamp: new Date(),
	};
}

const FIRST_MESSAGE = "diff git merge and rebase please in detail";

/**
 * In-memory port modelling SessionStorage.saveSession: an async wholesale
 * upsert-by-sessionId with a yield between read and write so concurrent
 * writers interleave (the production race window).
 */
class FakePort implements SessionStorePort {
	sessions: SavedSessionInfo[];
	constructor(initial: SavedSessionInfo[] = []) {
		this.sessions = initial;
	}
	getSavedSessions(): SavedSessionInfo[] {
		return this.sessions;
	}
	saveSession = async (info: SavedSessionInfo): Promise<void> => {
		const snapshot = [...this.sessions]; // read
		await Promise.resolve(); // yield — lets a concurrent saveSession interleave
		const idx = snapshot.findIndex((s) => s.sessionId === info.sessionId);
		if (idx >= 0) snapshot[idx] = info;
		else snapshot.unshift(info);
		this.sessions = snapshot; // write (wholesale, by id)
	};
}

function titleOf(port: FakePort, sessionId = SID): string | undefined {
	return port.sessions.find((s) => s.sessionId === sessionId)?.title;
}

describe("SessionStore save-ordering (I114)", () => {
	it("AI title survives a messages-only save fired concurrently (record pre-exists)", async () => {
		// Record already exists with the first-message title (created by an
		// earlier debounced save). The AI-title write and a turn-end
		// messages-only save then race.
		const port = new FakePort([
			{
				sessionId: SID,
				agentId: AGENT,
				cwd: CWD,
				title: FIRST_MESSAGE,
				createdAt: "2026-06-27T00:00:00.000Z",
				updatedAt: "2026-06-27T00:00:00.000Z",
			},
		]);
		const store = new SessionStore(port);

		const a = store.applySuggestedTitle({
			sessionId: SID,
			agentId: AGENT,
			cwd: CWD,
			suggestedTitle: AI_TITLE,
		});
		const b = store.recordTurnSave({
			sessionId: SID,
			agentId: AGENT,
			cwd: CWD,
			messages: [userMsg(FIRST_MESSAGE)],
		});
		await Promise.all([a, b]);

		expect(titleOf(port)).toBe(AI_TITLE);
	});

	it("AI title survives in the reverse order (messages-only fired first)", async () => {
		const port = new FakePort([
			{
				sessionId: SID,
				agentId: AGENT,
				cwd: CWD,
				title: FIRST_MESSAGE,
				createdAt: "2026-06-27T00:00:00.000Z",
				updatedAt: "2026-06-27T00:00:00.000Z",
			},
		]);
		const store = new SessionStore(port);

		const b = store.recordTurnSave({
			sessionId: SID,
			agentId: AGENT,
			cwd: CWD,
			messages: [userMsg(FIRST_MESSAGE)],
		});
		const a = store.applySuggestedTitle({
			sessionId: SID,
			agentId: AGENT,
			cwd: CWD,
			suggestedTitle: AI_TITLE,
		});
		await Promise.all([b, a]);

		expect(titleOf(port)).toBe(AI_TITLE);
	});

	it("AI title survives when the record does not exist yet (create race)", async () => {
		// No pre-existing record: the AI-title write and the first messages-only
		// save both run from an empty snapshot.
		const port = new FakePort([]);
		const store = new SessionStore(port);

		const a = store.applySuggestedTitle({
			sessionId: SID,
			agentId: AGENT,
			cwd: CWD,
			suggestedTitle: AI_TITLE,
		});
		const b = store.recordTurnSave({
			sessionId: SID,
			agentId: AGENT,
			cwd: CWD,
			messages: [userMsg(FIRST_MESSAGE)],
		});
		await Promise.all([a, b]);

		expect(port.sessions).toHaveLength(1);
		expect(titleOf(port)).toBe(AI_TITLE);
	});

	it("a later messages-only save never downgrades a committed AI title", async () => {
		// Sequential: AI title is committed, then a turn-end save lands.
		const port = new FakePort([]);
		const store = new SessionStore(port);

		await store.applySuggestedTitle({
			sessionId: SID,
			agentId: AGENT,
			cwd: CWD,
			suggestedTitle: AI_TITLE,
		});
		await store.recordTurnSave({
			sessionId: SID,
			agentId: AGENT,
			cwd: CWD,
			messages: [userMsg(FIRST_MESSAGE)],
		});

		expect(titleOf(port)).toBe(AI_TITLE);
	});

	it("a messages-only save creates a first-message title when no AI title exists", async () => {
		const port = new FakePort([]);
		const store = new SessionStore(port);

		await store.recordTurnSave({
			sessionId: SID,
			agentId: AGENT,
			cwd: CWD,
			messages: [userMsg(FIRST_MESSAGE)],
		});

		expect(titleOf(port)).toBe(FIRST_MESSAGE);
	});
});
