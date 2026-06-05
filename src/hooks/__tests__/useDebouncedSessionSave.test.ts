/**
 * I48: message tail lost on mid-stream reload.
 *
 * The debounced session save (extracted to useDebouncedSessionSave) used a
 * trailing-only debounce. Two failure modes for a mid-stream reload:
 *
 *  1. No unmount-flush — when the component unmounts (plugin reload / quit)
 *     with a pending debounced save, the cleanup clears the timer and the
 *     tail is never written.
 *  2. No max-wait — during continuous streaming, every token changes
 *     `messages`, which resets the 1s timer, so it never fires until the
 *     stream pauses >1s. A long continuous response checkpoints nothing.
 *
 * These tests reproduce both (red against the debounce-only revision) and
 * pin the fix: flush-on-unmount + a max-wait that forces a save during
 * sustained streaming.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDebouncedSessionSave } from "../useDebouncedSessionSave";
import type { ChatMessage } from "../../types/chat";
import type { ContextNote } from "../../types/context";

function msg(text: string): ChatMessage {
	return {
		id: `m-${text}`,
		role: "assistant",
		content: [{ type: "text", text }],
		timestamp: new Date(),
	};
}

describe("useDebouncedSessionSave (I48)", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("flushes the pending save on unmount (mid-stream reload)", () => {
		const save = vi.fn();
		const { rerender, unmount } = renderHook(
			({ messages }) =>
				useDebouncedSessionSave("sess-1", messages, [], save, 1000, 1000),
			{ initialProps: { messages: [msg("a")] } },
		);

		// A token arrives, then the component unmounts before the 1s debounce.
		rerender({ messages: [msg("a"), msg("b")] });
		unmount();

		// FIX: the tail must be flushed on unmount.
		expect(save).toHaveBeenCalledTimes(1);
		const [sid, saved] = save.mock.calls[0] as [string, ChatMessage[]];
		expect(sid).toBe("sess-1");
		expect(saved).toHaveLength(2);
	});

	it("forces a save within maxWait during continuous streaming", () => {
		const save = vi.fn();
		let messages: ChatMessage[] = [msg("0")];
		const { rerender } = renderHook(
			({ m }) => useDebouncedSessionSave("sess-1", m, [], save, 1000, 1000),
			{ initialProps: { m: messages } },
		);

		// Stream a chunk every 300ms for 1.5s — never a >1s quiet gap, so a
		// trailing-only debounce would never fire.
		for (let i = 1; i <= 5; i++) {
			messages = [...messages, msg(String(i))];
			rerender({ m: messages });
			vi.advanceTimersByTime(300);
		}

		// FIX: max-wait (1s) forces at least one save during the burst.
		expect(save).toHaveBeenCalled();
	});

	it("does not save when there is no session or no messages", () => {
		const save = vi.fn();
		const { rerender } = renderHook(
			({ sid, m }) => useDebouncedSessionSave(sid, m, [], save, 1000, 1000),
			{ initialProps: { sid: null as string | null, m: [] as ChatMessage[] } },
		);
		rerender({ sid: null, m: [msg("a")] });
		vi.advanceTimersByTime(2000);
		expect(save).not.toHaveBeenCalled();
	});

	it("forwards the latest context notes to save on flush (I65)", () => {
		const save = vi.fn();
		const notesA: ContextNote[] = [
			{ path: "a.md", source: "user", seen: false },
		];
		const notesB: ContextNote[] = [
			{ path: "a.md", source: "user", seen: false },
			{ path: "b.md", source: "user", seen: false },
		];
		const { rerender, unmount } = renderHook(
			({ messages, notes }) =>
				useDebouncedSessionSave("sess-1", messages, notes, save, 1000, 1000),
			{ initialProps: { messages: [msg("a")], notes: notesA } },
		);

		rerender({ messages: [msg("a"), msg("b")], notes: notesB });
		unmount();

		expect(save).toHaveBeenCalledTimes(1);
		const call = save.mock.calls[0] as [string, ChatMessage[], ContextNote[]];
		expect(call[2]).toEqual(notesB);
	});
});
