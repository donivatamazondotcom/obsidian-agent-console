/**
 * I193: session message tail lost on teardown (I48 recurrence).
 *
 * The v1.1.0 I48 fix added an unmount-flush to `useDebouncedSessionSave`, but
 * that flush calls `save()` fire-and-forget — the underlying async disk write
 * (`settingsAccess.saveSessionMessages`) is never awaited. `ChatView.onClose`
 * awaits the tab-state `flushSave`, then `root.unmount()` triggers this
 * unmount-flush and returns — so on a real quit/reload the app can exit before
 * the session write lands, and the final turn is lost from the message file.
 *
 * The fix mirrors tab-state's awaited `flushSave`: the hook exposes an
 * awaitable `flushPending()` that resolves only after the write settles, and
 * `ChatView.onClose` awaits it before unmount.
 *
 * This test pins that contract: `flushPending()` must await the async save.
 * RED against the current hook (returns void — no flushPending, flush is
 * fire-and-forget); GREEN once the awaited flush lands.
 */

import { describe, it, expect, vi } from "vitest";
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

describe("useDebouncedSessionSave — I193 awaited teardown flush", () => {
	it("flushPending() resolves only after the async save write settles", async () => {
		let landed = false;
		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		// Models the real chain: save kicks off an async disk write.
		const save = vi.fn(
			(_sid: string, _m: ChatMessage[], _n: ContextNote[]) =>
				gate.then(() => {
					landed = true;
				}),
		);

		const { result, rerender } = renderHook(
			({ m }) =>
				useDebouncedSessionSave("sess-1", m, [], save, 1000, 1000),
			{ initialProps: { m: [msg("a")] as ChatMessage[] } },
		);

		// A completed turn's messages are pending (debounce timer not yet fired).
		rerender({ m: [msg("a"), msg("b")] });

		// Teardown must be able to AWAIT the session write, mirroring the
		// tab-state flushSave that ChatView.onClose already awaits.
		const flushed = result.current.flushPending();

		// The flush fired the save, but the write is still in flight — the
		// flush promise MUST NOT resolve until the write settles.
		expect(save).toHaveBeenCalledTimes(1);
		expect(landed).toBe(false);

		release();
		await flushed;

		// The write settled before the flush resolved → the tail is durable
		// across teardown.
		expect(landed).toBe(true);
	});
});
