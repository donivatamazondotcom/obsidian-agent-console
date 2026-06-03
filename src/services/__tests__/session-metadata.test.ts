/**
 * Unit tests for saved-session metadata writes (I58).
 *
 * I58 (session missing from history list despite transcript on disk): on the
 * queued send-before-connect path, the first-message `saveSessionLocally` gate
 * runs in a stale closure and never creates the `savedSessions` entry, while
 * the turn-end transcript save (fresh state) still writes the message file.
 * Result: a real conversation has a transcript on disk but never appears in
 * the Session History modal.
 *
 * Fix: the turn-end metadata write CREATES the history entry when none exists,
 * so a session with a transcript can never be orphaned.
 */

import { describe, it, expect } from "vitest";

import {
	resolveSessionMetadataWrite,
	deriveSessionTitle,
} from "../session-metadata";
import type { ChatMessage } from "../../types/chat";
import type { SavedSessionInfo } from "../../types/session";

const NOW = "2026-06-02T19:00:00.000Z";

function userMsg(text: string): ChatMessage {
	return {
		id: "m1",
		role: "user",
		content: [{ type: "text", text }],
		timestamp: new Date(),
	};
}

describe("resolveSessionMetadataWrite (I58)", () => {
	it("bumps updatedAt and preserves identity for an existing entry", () => {
		const existing: SavedSessionInfo = {
			sessionId: "s1",
			agentId: "auto-sa",
			cwd: "/work",
			title: "Old title",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		};

		const w = resolveSessionMetadataWrite(existing, {
			sessionId: "s1",
			agentId: "auto-sa",
			cwd: "/work",
			messages: [userMsg("hi")],
			now: NOW,
		});

		expect(w).not.toBeNull();
		expect(w!.updatedAt).toBe(NOW);
		expect(w!.createdAt).toBe(existing.createdAt);
		expect(w!.title).toBe("Old title");
	});

	it("creates a history entry when none exists (transcript must not be orphaned)", () => {
		// Reproduces I58: a turn-end transcript save where the metadata entry
		// was never created (first-message gate skipped on send-before-connect).
		const w = resolveSessionMetadataWrite(undefined, {
			sessionId: "s2",
			agentId: "auto-sa",
			cwd: "/work",
			messages: [userMsg("Reconcile the TCOM doc comments")],
			now: NOW,
		});

		expect(w).not.toBeNull();
		expect(w!.sessionId).toBe("s2");
		expect(w!.agentId).toBe("auto-sa");
		expect(w!.cwd).toBe("/work");
		expect(w!.title).toBe("Reconcile the TCOM doc comments");
		expect(w!.createdAt).toBe(NOW);
		expect(w!.updatedAt).toBe(NOW);
	});
});

describe("deriveSessionTitle", () => {
	it("uses first user message text, truncated to 50 chars", () => {
		const long = "x".repeat(60);
		expect(deriveSessionTitle([userMsg(long)])).toBe("x".repeat(50) + "...");
	});

	it("falls back to 'Session' when there is no user text", () => {
		expect(deriveSessionTitle([])).toBe("Session");
	});
});
