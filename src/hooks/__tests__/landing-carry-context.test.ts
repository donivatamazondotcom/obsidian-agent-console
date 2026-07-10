/**
 * Landing carry-context — cross-boundary payload lifecycle test.
 *
 * Part of "Close Last Tab to Empty State" § carry-context (`context:"carry"`).
 * When the user pins notes on the zero-tab landing and launches, ChatView
 * serializes them into `pendingPromptByTab[newTabId].contextNotes`. Those notes
 * cross the spawn boundary and must be DESERIALIZED and APPLIED to the fresh
 * tab's context state so the first message carries them.
 *
 * Per `sdlc.md` § Cross-Boundary State Features, this is a lifecycle test, not
 * a pure-fn test: it composes the REAL receiving chain a spawned launch tab
 * runs on mount —
 *
 *   payload.contextNotes                 (serialized across the spawn boundary)
 *     → resolveSeededContextNotes(...)   (deserialize / route, lowest precedence)
 *     → useRestoredMessages(...)         (apply once, ONLY while idle)
 *     → useContextNotes().notes          (available to the first message)
 *
 * The send path turning contextNotes.notes into the first message's context is
 * covered separately by useChatActions' send-payload test; this test proves the
 * carried pins actually arrive in the spawned tab's context state.
 */
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useContextNotes } from "../useContextNotes";
import { useRestoredMessages } from "../useRestoredMessages";
import { resolveSeededContextNotes } from "../../utils/restored-tab-content";
import type { ContextNote } from "../../types/context";

const PINNED: ContextNote[] = [
	{ path: "Notes/API.md", source: "user", seen: false },
	{ path: "Notes/Spec.md", source: "mention", seen: false },
];

/**
 * The receiving-side chain a freshly-spawned launch tab runs on mount. `payload`
 * is the `pendingPromptByTab[tabId]` entry; `hasSession` models whether a live
 * session already exists (the clobber guard).
 */
function useSpawnedTabContext(
	payload: { contextNotes?: ContextNote[] },
	hasSession: boolean,
) {
	const contextNotes = useContextNotes();
	const restoredContextNotes = resolveSeededContextNotes({
		launchContextNotes: payload.contextNotes,
	});
	useRestoredMessages({
		restoredMessages: [], // a launch tab has no restored transcript
		restoredContextNotes,
		hasSession,
		apply: () => undefined,
		applyContextNotes: contextNotes.replace,
	});
	return contextNotes.notes;
}

describe("landing carry-context — cross-boundary payload lifecycle", () => {
	it("carries pinned notes across the spawn boundary into the fresh tab's context", () => {
		const { result } = renderHook(() =>
			useSpawnedTabContext({ contextNotes: PINNED }, false),
		);
		expect(result.current.map((n) => n.path)).toEqual([
			"Notes/API.md",
			"Notes/Spec.md",
		]);
		// Source is preserved across the boundary (drives pill styling + save).
		expect(result.current.map((n) => n.source)).toEqual([
			"user",
			"mention",
		]);
	});

	it("a launch with no pinned notes seeds an empty context strip", () => {
		const { result } = renderHook(() =>
			useSpawnedTabContext({ contextNotes: [] }, false),
		);
		expect(result.current).toEqual([]);
	});

	it("does NOT apply carried notes when a live session already exists (clobber guard)", () => {
		// hasSession:true models a tab that already connected — restored/carried
		// state must never overwrite an active conversation (I43 guard).
		const { result } = renderHook(() =>
			useSpawnedTabContext({ contextNotes: PINNED }, true),
		);
		expect(result.current).toEqual([]);
	});
});
