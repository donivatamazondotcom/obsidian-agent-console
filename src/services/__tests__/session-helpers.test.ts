/**
 * Unit tests for resolveSessionIdForSave (I59).
 *
 * I59: after restore, a tab's live session is lazy (null until first
 * keystroke), but its prior sessionId is persisted. The tab-persistence
 * save must NOT overwrite the persisted id with null — otherwise the next
 * reload can't load message history and the tab restores with title only.
 * The save resolves to the live id, falling back to the persisted id.
 */

import { describe, it, expect } from "vitest";
import { resolveSessionIdForSave } from "../session-helpers";

describe("resolveSessionIdForSave (I59)", () => {
	it("falls back to the persisted id when the live id is null (restored, pre-reconnect)", () => {
		expect(resolveSessionIdForSave(null, "sess-A")).toBe("sess-A");
	});

	it("uses the live id when present (acquisition / reconnect wins over persisted)", () => {
		expect(resolveSessionIdForSave("live-B", "sess-A")).toBe("live-B");
	});

	it("returns null when neither is present (fresh tab never sent a message)", () => {
		expect(resolveSessionIdForSave(null, null)).toBe(null);
	});
});
