/**
 * resolveSeededMessages / resolveSeededContextNotes — tab seeding precedence.
 *
 * REGRESSION GUARD (smoke round 2, D): the Session History Source Model rebase
 * dropped the `forkPayload` source from ChatView's restoredMessages/contextNotes
 * props, so a forked tab opened EMPTY ("Start a conversation…") and — because
 * isFirstMessage = messages.length === 0 — the user's first message then
 * overwrote the "Fork: …" title with an AI title. The fork-only case below is
 * the exact failure.
 */
import { describe, it, expect } from "vitest";
import {
	resolveSeededMessages,
	resolveSeededContextNotes,
} from "../restored-tab-content";
import type { ChatMessage } from "../../types/chat";
import type { ContextNote } from "../../types/context";

const msg = (id: string): ChatMessage =>
	({ id, role: "user", content: id }) as unknown as ChatMessage;
const note = (path: string): ContextNote =>
	({ path }) as unknown as ContextNote;

describe("resolveSeededMessages — precedence restore → fork → startup", () => {
	it("REGRESSION: a fork-only tab (only forkPayload set) seeds from the fork transcript", () => {
		const out = resolveSeededMessages({
			restore: undefined,
			fork: { messages: [msg("a"), msg("b")] },
			persistedMessages: undefined,
		});
		expect(out?.map((m) => m.id)).toEqual(["a", "b"]);
	});

	it("restore wins over fork and startup", () => {
		expect(
			resolveSeededMessages({
				restore: { messages: [msg("r")] },
				fork: { messages: [msg("f")] },
				persistedMessages: [msg("p")],
			})?.map((m) => m.id),
		).toEqual(["r"]);
	});

	it("fork wins over startup when restore is absent", () => {
		expect(
			resolveSeededMessages({
				fork: { messages: [msg("f")] },
				persistedMessages: [msg("p")],
			})?.map((m) => m.id),
		).toEqual(["f"]);
	});

	it("falls back to startup-restore when neither restore nor fork is set", () => {
		expect(
			resolveSeededMessages({
				persistedMessages: [msg("p")],
			})?.map((m) => m.id),
		).toEqual(["p"]);
	});

	it("is undefined for a fresh tab with no seed source", () => {
		expect(resolveSeededMessages({})).toBeUndefined();
	});
});

describe("resolveSeededContextNotes — precedence restore → fork → startup", () => {
	it("REGRESSION: a fork-only tab seeds its context notes from the fork payload", () => {
		expect(
			resolveSeededContextNotes({
				fork: { contextNotes: [note("A.md")] },
			})?.map((n) => n.path),
		).toEqual(["A.md"]);
	});

	it("restore wins over fork and startup", () => {
		expect(
			resolveSeededContextNotes({
				restore: { contextNotes: [note("R.md")] },
				fork: { contextNotes: [note("F.md")] },
				persistedContextNotes: [note("P.md")],
			})?.map((n) => n.path),
		).toEqual(["R.md"]);
	});

	it("is undefined for a fresh tab", () => {
		expect(resolveSeededContextNotes({})).toBeUndefined();
	});
});
