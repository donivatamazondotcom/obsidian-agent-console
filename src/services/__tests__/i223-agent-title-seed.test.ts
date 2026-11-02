/**
 * I223 (b) — reproduce-first: restoring a session the agent lists as "X",
 * with no local record, saves the local record with title X.
 *
 * Bug: the first save after an agent-only restore creates the local record,
 * and `deriveSessionRecordTitle` (AI > existing > first message) has no input
 * for the agent's own title, so it falls back to the first replayed user
 * message (the injected system prompt, I222). `mergeWithLocalTitles` then
 * overlays that bad local title on the agent list too.
 *
 * Fix contract under test: the single writer (`SessionStore.recordTurnSave`,
 * reached via `useSessionHistory.saveSessionMessages`) accepts the agent's
 * title as a CREATE-ONLY seed: AI > existing > agent title > first message.
 * A seed never overrides an existing record (a manual rename or AI title).
 *
 * Kiro V3 detail (trace 2026-11-01): when V3 has not generated a title, its
 * `session/list` title is the first line of the stored prompt —
 * literally "<obsidian_system_instruction>". That is not a real title and
 * must not be seeded.
 */
import { describe, it, expect } from "vitest";

import { SessionStore, type SessionStorePort } from "../session-store";
import type { ChatMessage } from "../../types/chat";
import type { SavedSessionInfo } from "../../types/session";

const SID = "sess_1";
const AGENT_TITLE = "Kiro integration with Obsidian";

class Port implements SessionStorePort {
	constructor(public sessions: SavedSessionInfo[] = []) {}
	getSavedSessions() {
		return this.sessions;
	}
	saveSession = async (info: SavedSessionInfo) => {
		const i = this.sessions.findIndex((s) => s.sessionId === info.sessionId);
		this.sessions =
			i >= 0
				? this.sessions.map((s, j) => (j === i ? info : s))
				: [...this.sessions, info];
	};
	deleteSession = async () => {};
}

function user(text: string): ChatMessage {
	return { id: "u", role: "user", content: [{ type: "text", text }], timestamp: new Date() };
}

const replayed = [user("<obsidian_system_instruction>\nYou are running inside Obsidian…")];

function save(store: SessionStore, seedTitle: string | null, messages = replayed) {
	return store.recordTurnSave({
		sessionId: SID,
		agentId: "kiro",
		cwd: "/vault",
		messages,
		seedTitle,
	});
}

describe("I223 — agent-only restore keeps the agent's title", () => {
	it("(b) no local record + agent title X → the saved record is titled X", async () => {
		const port = new Port();
		await save(new SessionStore(port), AGENT_TITLE);
		expect(port.sessions[0]?.title).toBe(AGENT_TITLE);
	});

	it("a seed never overrides an existing local title (manual rename / AI title)", async () => {
		const port = new Port([
			{ sessionId: SID, agentId: "kiro", cwd: "/vault", title: "My rename", createdAt: "t", updatedAt: "t" },
		]);
		await save(new SessionStore(port), AGENT_TITLE);
		expect(port.sessions[0].title).toBe("My rename");
	});

	it("a V3 placeholder title ('<obsidian_system_instruction>') is not seeded", async () => {
		const port = new Port();
		await save(new SessionStore(port), "<obsidian_system_instruction>", [user("Plan the offsite")]);
		expect(port.sessions[0]?.title).toBe("Plan the offsite");
	});
});
