/**
 * `resolveSeededMessages` / `resolveSeededContextNotes` — the single resolver
 * for a tab's seeded transcript + context notes when it mounts.
 *
 * A tab can be seeded from THREE sources, in precedence order:
 *   1. **restore** (`reopenPayload`) — Session History "restore" opened it.
 *   2. **fork** (`forkPayload`) — Session History "fork" branched it.
 *   3. **startup restore** (`tabPersistence`) — restored across an app restart.
 *
 * These must ALL feed the ChatPanel's `restoredMessages` / `restoredContextNotes`
 * props. A fork tab has ONLY a `forkPayload` entry, so dropping the fork source
 * leaves a forked tab with no seeded transcript — it renders the empty
 * "Start a conversation…" state, and because `isFirstMessage` is
 * `messages.length === 0` (useChatActions), the user's first message then
 * triggers the AI-title rubric and overwrites the "Fork: …" title. Both
 * symptoms are one bug: the fork source was missing from the precedence.
 * (Regressed in the Session History Source Model rebase; this resolver makes
 * the precedence explicit and tested so it can't silently drop a source again.)
 *
 * Pure — no React, no Obsidian.
 */
import type { ChatMessage } from "../types/chat";
import type { ContextNote } from "../types/context";

/** A seed payload from the restore or fork path. */
export interface TabSeedPayload {
	messages?: ChatMessage[];
	contextNotes?: ContextNote[];
}

/** The three seeding sources for a tab, by precedence. */
export interface TabSeedSources {
	/** Restore path (reopenPayload[tabId]). */
	restore?: TabSeedPayload;
	/** Fork path (forkPayload[tabId]). */
	fork?: TabSeedPayload;
	/** Startup-restore transcript (tabPersistence.restoredMessages[tabId]). */
	persistedMessages?: ChatMessage[];
	/** Startup-restore context notes (tabPersistence.restoredContextNotes[tabId]). */
	persistedContextNotes?: ContextNote[];
}

/** Resolve the seeded transcript: restore → fork → startup restore. */
export function resolveSeededMessages(
	s: TabSeedSources,
): ChatMessage[] | undefined {
	return s.restore?.messages ?? s.fork?.messages ?? s.persistedMessages;
}

/** Resolve the seeded context notes: restore → fork → startup restore. */
export function resolveSeededContextNotes(
	s: TabSeedSources,
): ContextNote[] | undefined {
	return (
		s.restore?.contextNotes ??
		s.fork?.contextNotes ??
		s.persistedContextNotes
	);
}
