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

// ============================================================================
// Track C / RC-2 — fork title must survive via the single writer
// ============================================================================

describe("SessionStore — explicit fork title preservation", () => {
	it("keeps an explicit 'Fork: …' title across a concurrent and a later no-title turn-end save", async () => {
		// Agent-agnostic fork sets an explicit "Fork: …" title at branch
		// creation through the SINGLE writer; the seeded transcript means no AI
		// title is ever generated, so the first turn-end save carries no
		// suggestedTitle. The 723f868 bug used a DIRECT settingsService
		// .saveSession for the fork persist, which raced the turn-end
		// recordTurnSave and clobbered "Fork: hi" with the first-message text.
		// Routed through the one serialized writer, the explicit title survives.
		const FORK_TITLE = "Fork: hi";
		const port = new FakePort();
		const store = new SessionStore(port);

		// Eager fork persist (explicit title) + concurrent turn-end save (none).
		await Promise.all([
			store.recordTurnSave({
				sessionId: SID,
				agentId: AGENT,
				cwd: CWD,
				messages: [userMsg(FIRST_MESSAGE)],
				suggestedTitle: FORK_TITLE,
			}),
			store.recordTurnSave({
				sessionId: SID,
				agentId: AGENT,
				cwd: CWD,
				messages: [userMsg(FIRST_MESSAGE)],
				suggestedTitle: null,
			}),
		]);
		expect(titleOf(port)).toBe(FORK_TITLE);

		// A later turn-end save (still no AI title) preserves it too.
		await store.recordTurnSave({
			sessionId: SID,
			agentId: AGENT,
			cwd: CWD,
			messages: [userMsg(FIRST_MESSAGE), userMsg("a follow-up")],
			suggestedTitle: null,
		});
		expect(titleOf(port)).toBe(FORK_TITLE);
	});
});

// ============================================================================
// Phase 4 / §2c — rename + first-message writes routed through the single
// writer (the former "1b"). The 5 direct settingsService.saveSession sites in
// ui/ + hooks/ raced the serialized turn-end / AI-title writers; routing them
// through renameSession / recordFirstMessage on the ONE shared SessionStore
// removes the clobber.
// ============================================================================

const RENAME = "Quarterly planning notes";

describe("SessionStore.renameSession (explicit title wins)", () => {
	it("an explicit rename survives a concurrent no-title turn-end save (both orders)", async () => {
		for (const renameFirst of [true, false]) {
			const port = new FakePort([
				{
					sessionId: SID,
					agentId: AGENT,
					cwd: CWD,
					title: FIRST_MESSAGE,
					createdAt: "2026-06-29T00:00:00.000Z",
					updatedAt: "2026-06-29T00:00:00.000Z",
				},
			]);
			const store = new SessionStore(port);

			const rename = () =>
				store.renameSession({
					sessionId: SID,
					agentId: AGENT,
					cwd: CWD,
					title: RENAME,
					createIfMissing: false,
				});
			const turn = () =>
				store.recordTurnSave({
					sessionId: SID,
					agentId: AGENT,
					cwd: CWD,
					messages: [userMsg(FIRST_MESSAGE)],
				});

			await Promise.all(renameFirst ? [rename(), turn()] : [turn(), rename()]);
			expect(titleOf(port)).toBe(RENAME);
		}
	});

	it("creates a record for an agent-side-only session when createIfMissing", async () => {
		const port = new FakePort([]);
		const store = new SessionStore(port);

		await store.renameSession({
			sessionId: SID,
			agentId: AGENT,
			cwd: CWD,
			title: RENAME,
			createIfMissing: true,
		});

		expect(port.sessions).toHaveLength(1);
		expect(titleOf(port)).toBe(RENAME);
	});

	it("is a no-op when the session is not in history and createIfMissing is false (tab-rename contract)", async () => {
		const port = new FakePort([]);
		const store = new SessionStore(port);

		await store.renameSession({
			sessionId: SID,
			agentId: AGENT,
			cwd: CWD,
			title: RENAME,
			createIfMissing: false,
		});

		expect(port.sessions).toHaveLength(0);
	});

	it("keeps an explicit fork title across a concurrent and a later no-title turn save", async () => {
		// Fork create routes through renameSession(createIfMissing) on the new
		// session id; the restored transcript then triggers turn-end saves with
		// no suggestedTitle. The explicit fork title must survive.
		const FORK_TITLE = "Fork: hi";
		const port = new FakePort([]);
		const store = new SessionStore(port);

		await Promise.all([
			store.renameSession({
				sessionId: SID,
				agentId: AGENT,
				cwd: CWD,
				title: FORK_TITLE,
				createIfMissing: true,
			}),
			store.recordTurnSave({
				sessionId: SID,
				agentId: AGENT,
				cwd: CWD,
				messages: [userMsg(FIRST_MESSAGE)],
			}),
		]);
		expect(titleOf(port)).toBe(FORK_TITLE);

		await store.recordTurnSave({
			sessionId: SID,
			agentId: AGENT,
			cwd: CWD,
			messages: [userMsg(FIRST_MESSAGE), userMsg("follow-up")],
		});
		expect(titleOf(port)).toBe(FORK_TITLE);
	});

	it("TWO independent SessionStore instances on one port clobber the rename (why the hoist is required)", async () => {
		// Pre-hoist reality: ChatView's tab rename used a direct
		// settingsService.saveSession while useSessionHistory's turn save went
		// through its own per-hook SessionStore. Independent queues do NOT
		// serialize against each other, so both read the same stale snapshot
		// and the last writer wins — the rename is lost. This guards the
		// rationale for one shared instance (settingsService.sessionStore).
		const port = new FakePort([
			{
				sessionId: SID,
				agentId: AGENT,
				cwd: CWD,
				title: FIRST_MESSAGE,
				createdAt: "2026-06-29T00:00:00.000Z",
				updatedAt: "2026-06-29T00:00:00.000Z",
			},
		]);
		const renamer = new SessionStore(port);
		const saver = new SessionStore(port);

		await Promise.all([
			renamer.renameSession({
				sessionId: SID,
				agentId: AGENT,
				cwd: CWD,
				title: RENAME,
				createIfMissing: false,
			}),
			saver.recordTurnSave({
				sessionId: SID,
				agentId: AGENT,
				cwd: CWD,
				messages: [userMsg(FIRST_MESSAGE)],
			}),
		]);

		// The turn-save (holding the pre-rename snapshot) clobbers the rename.
		expect(titleOf(port)).toBe(FIRST_MESSAGE);
	});
});

describe("SessionStore.recordFirstMessage (first-message title is a fallback)", () => {
	it("creates a first-message title when no record exists", async () => {
		const port = new FakePort([]);
		const store = new SessionStore(port);

		await store.recordFirstMessage({
			sessionId: SID,
			agentId: AGENT,
			cwd: CWD,
			firstMessageTitle: FIRST_MESSAGE,
		});

		expect(port.sessions).toHaveLength(1);
		expect(titleOf(port)).toBe(FIRST_MESSAGE);
	});

	it("never downgrades an existing AI title (the saveSessionLocally race)", async () => {
		// An AI title resolved before the first-message save landed. The direct
		// saveSessionLocally used to overwrite it with the first-message text.
		const port = new FakePort([]);
		const store = new SessionStore(port);

		await Promise.all([
			store.applySuggestedTitle({
				sessionId: SID,
				agentId: AGENT,
				cwd: CWD,
				suggestedTitle: AI_TITLE,
			}),
			store.recordFirstMessage({
				sessionId: SID,
				agentId: AGENT,
				cwd: CWD,
				firstMessageTitle: FIRST_MESSAGE,
			}),
		]);

		expect(titleOf(port)).toBe(AI_TITLE);
	});

	it("preserves a manual rename that landed first", async () => {
		const port = new FakePort([]);
		const store = new SessionStore(port);

		await store.renameSession({
			sessionId: SID,
			agentId: AGENT,
			cwd: CWD,
			title: RENAME,
			createIfMissing: true,
		});
		await store.recordFirstMessage({
			sessionId: SID,
			agentId: AGENT,
			cwd: CWD,
			firstMessageTitle: FIRST_MESSAGE,
		});

		expect(titleOf(port)).toBe(RENAME);
	});
});
