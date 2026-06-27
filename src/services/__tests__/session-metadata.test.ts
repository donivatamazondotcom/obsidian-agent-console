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
	deriveSessionRecordTitle,
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
			agentId: "test-agent",
			cwd: "/work",
			title: "Old title",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		};

		const w = resolveSessionMetadataWrite(existing, {
			sessionId: "s1",
			agentId: "test-agent",
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
			agentId: "test-agent",
			cwd: "/work",
			messages: [userMsg("Reconcile the TCOM doc comments")],
			now: NOW,
		});

		expect(w).not.toBeNull();
		expect(w!.sessionId).toBe("s2");
		expect(w!.agentId).toBe("test-agent");
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

describe("deriveSessionRecordTitle (I114 precedence)", () => {
	const existing: SavedSessionInfo = {
		sessionId: "s1",
		agentId: "test-agent",
		cwd: "/work",
		title: "Existing title",
		createdAt: NOW,
		updatedAt: NOW,
	};

	it("AI-suggested title wins over an existing title", () => {
		expect(
			deriveSessionRecordTitle({
				existing,
				suggestedTitle: "AI title",
				messages: [userMsg("hello there")],
			}),
		).toBe("AI title");
	});

	it("AI-suggested title wins over the first-message fallback when no entry exists", () => {
		expect(
			deriveSessionRecordTitle({
				suggestedTitle: "AI title",
				messages: [userMsg("hello there")],
			}),
		).toBe("AI title");
	});

	it("preserves the existing title (manual rename / prior AI) when no AI title is supplied", () => {
		expect(
			deriveSessionRecordTitle({
				existing,
				suggestedTitle: null,
				messages: [userMsg("a brand new first message")],
			}),
		).toBe("Existing title");
	});

	it("falls back to the first-message title when there is no existing entry and no AI title", () => {
		expect(
			deriveSessionRecordTitle({
				suggestedTitle: undefined,
				messages: [userMsg("the first message text")],
			}),
		).toBe("the first message text");
	});

	it("treats a blank/whitespace AI suggestion as absent", () => {
		expect(
			deriveSessionRecordTitle({
				existing,
				suggestedTitle: "   ",
				messages: [userMsg("hi")],
			}),
		).toBe("Existing title");
	});

	it("falls back to first-message when an existing entry has no title and no AI title", () => {
		const titleless: SavedSessionInfo = { ...existing, title: undefined };
		expect(
			deriveSessionRecordTitle({
				existing: titleless,
				messages: [userMsg("first message here")],
			}),
		).toBe("first message here");
	});
});

describe("resolveSessionMetadataWrite (I114 title-aware)", () => {
	it("sets the AI title on the existing path when suggestedTitle is supplied", () => {
		const existing: SavedSessionInfo = {
			sessionId: "s1",
			agentId: "test-agent",
			cwd: "/work",
			title: "First message text",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		};
		const w = resolveSessionMetadataWrite(existing, {
			sessionId: "s1",
			agentId: "test-agent",
			cwd: "/work",
			messages: [userMsg("First message text")],
			now: NOW,
			suggestedTitle: "Resolved AI title",
		});
		expect(w!.title).toBe("Resolved AI title");
		expect(w!.updatedAt).toBe(NOW);
		expect(w!.createdAt).toBe(existing.createdAt);
	});

	it("creates with the AI title when suggestedTitle is supplied and no entry exists", () => {
		const w = resolveSessionMetadataWrite(undefined, {
			sessionId: "s2",
			agentId: "test-agent",
			cwd: "/work",
			messages: [userMsg("the first message")],
			now: NOW,
			suggestedTitle: "AI created title",
		});
		expect(w!.title).toBe("AI created title");
		expect(w!.createdAt).toBe(NOW);
	});

	it("preserves the existing title on a messages-only write (no clobber)", () => {
		const existing: SavedSessionInfo = {
			sessionId: "s1",
			agentId: "test-agent",
			cwd: "/work",
			title: "Resolved AI title",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		};
		const w = resolveSessionMetadataWrite(existing, {
			sessionId: "s1",
			agentId: "test-agent",
			cwd: "/work",
			messages: [userMsg("First message text")],
			now: NOW,
		});
		expect(w!.title).toBe("Resolved AI title");
	});
});
