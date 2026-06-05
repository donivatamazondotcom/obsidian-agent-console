/**
 * Tests for useRestoredMessages — async-load-then-seed for I43.
 *
 * Per spec Decision #12: restored session message bodies arrive
 * asynchronously (separate per-session files on disk, surfaced by
 * useTabPersistence). This hook applies them to the message list exactly
 * once, when they arrive, and only while the tab is still idle (no live
 * session) so it can never clobber an active or newly-created conversation.
 *
 * The hook is the extract-and-share seam: ChatPanel calls the same hook the
 * test exercises, so these tests are a real regression guard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRestoredMessages } from "../useRestoredMessages";
import type { ChatMessage } from "../../types/chat";
import type { ContextNote } from "../../types/context";

function msg(id: string, text: string): ChatMessage {
	return {
		id,
		role: "user",
		content: [{ type: "text", text }],
		timestamp: new Date(),
	};
}

const RESTORED: ChatMessage[] = [msg("m1", "hello"), msg("m2", "world")];

describe("useRestoredMessages", () => {
	let apply: ReturnType<typeof vi.fn>;
	beforeEach(() => {
		apply = vi.fn();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("does not apply when restoredMessages is undefined", () => {
		renderHook(() =>
			useRestoredMessages({
				restoredMessages: undefined,
				hasSession: false,
				apply,
			}),
		);
		expect(apply).not.toHaveBeenCalled();
	});

	it("does not apply when restoredMessages is empty", () => {
		renderHook(() =>
			useRestoredMessages({
				restoredMessages: [],
				hasSession: false,
				apply,
			}),
		);
		expect(apply).not.toHaveBeenCalled();
	});

	it("applies once when messages arrive async (undefined → populated) while idle", () => {
		const { rerender } = renderHook(
			(props: {
				restoredMessages: ChatMessage[] | undefined;
				hasSession: boolean;
			}) =>
				useRestoredMessages({
					restoredMessages: props.restoredMessages,
					hasSession: props.hasSession,
					apply,
				}),
			{ initialProps: { restoredMessages: undefined, hasSession: false } },
		);
		// Mount: nothing yet (async not resolved).
		expect(apply).not.toHaveBeenCalled();

		// Async arrival.
		rerender({ restoredMessages: RESTORED, hasSession: false });
		expect(apply).toHaveBeenCalledTimes(1);
		expect(apply).toHaveBeenCalledWith(RESTORED);
	});

	it("does NOT apply a second time on subsequent re-renders", () => {
		const { rerender } = renderHook(
			(props: {
				restoredMessages: ChatMessage[] | undefined;
				hasSession: boolean;
			}) =>
				useRestoredMessages({
					restoredMessages: props.restoredMessages,
					hasSession: props.hasSession,
					apply,
				}),
			{ initialProps: { restoredMessages: RESTORED, hasSession: false } },
		);
		expect(apply).toHaveBeenCalledTimes(1);

		rerender({ restoredMessages: RESTORED, hasSession: false });
		rerender({ restoredMessages: RESTORED, hasSession: true });
		expect(apply).toHaveBeenCalledTimes(1);
	});

	it("does NOT apply when a session already exists (clobber guard / type-before-restore race)", () => {
		const { rerender } = renderHook(
			(props: {
				restoredMessages: ChatMessage[] | undefined;
				hasSession: boolean;
			}) =>
				useRestoredMessages({
					restoredMessages: props.restoredMessages,
					hasSession: props.hasSession,
					apply,
				}),
			{ initialProps: { restoredMessages: undefined, hasSession: false } },
		);
		// User typed first → session acquired before restore resolved.
		rerender({ restoredMessages: undefined, hasSession: true });
		// Now the disk read resolves — but a session exists, so skip.
		rerender({ restoredMessages: RESTORED, hasSession: true });
		expect(apply).not.toHaveBeenCalled();
	});
});

describe("useRestoredMessages — context-note restore (I61)", () => {
	const NOTES: ContextNote[] = [{ path: "A.md", source: "user", seen: false }];

	it("applies restored context notes when idle", () => {
		const apply = vi.fn();
		const applyContextNotes = vi.fn();
		renderHook(() =>
			useRestoredMessages({
				restoredMessages: undefined,
				restoredContextNotes: NOTES,
				hasSession: false,
				apply,
				applyContextNotes,
			}),
		);
		expect(applyContextNotes).toHaveBeenCalledWith(NOTES);
	});

	it("does NOT apply context notes when a live session exists", () => {
		const applyContextNotes = vi.fn();
		renderHook(() =>
			useRestoredMessages({
				restoredMessages: undefined,
				restoredContextNotes: NOTES,
				hasSession: true,
				apply: vi.fn(),
				applyContextNotes,
			}),
		);
		expect(applyContextNotes).not.toHaveBeenCalled();
	});
});
