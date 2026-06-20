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
import {
	resolveSessionIdForSave,
	resolveRenamedSessionWrite,
} from "../session-helpers";
import type { SavedSessionInfo } from "../../types/session";

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

describe("resolveRenamedSessionWrite (I73)", () => {
	const NOW = "2026-06-20T05:00:00.000Z";
	const saved: SavedSessionInfo = {
		sessionId: "sess-A",
		agentId: "claude",
		cwd: "/vault",
		title: "Old derived title",
		createdAt: "2026-06-19T00:00:00.000Z",
		updatedAt: "2026-06-19T00:00:00.000Z",
	};

	it("writes the new title for a restored tab whose live id is null but persisted id matches (the I73 bug)", () => {
		// Pre-fix handleRenameTab read the live map only -> null -> skipped
		// the saveSession write, so the rename was lost from history.
		const result = resolveRenamedSessionWrite(
			null, // live id — restored tab not yet reconnected
			"sess-A", // persisted id
			[saved],
			"TPA scheduling",
			NOW,
		);
		expect(result).toEqual({
			...saved,
			title: "TPA scheduling",
			updatedAt: NOW,
		});
	});

	it("writes the new title using the live id when present (reconnected tab)", () => {
		const result = resolveRenamedSessionWrite(
			"sess-A",
			null,
			[saved],
			"Reconnected rename",
			NOW,
		);
		expect(result).toEqual({
			...saved,
			title: "Reconnected rename",
			updatedAt: NOW,
		});
	});

	it("returns null when the tab has no resolvable session (fresh tab, never messaged)", () => {
		expect(
			resolveRenamedSessionWrite(null, null, [saved], "X", NOW),
		).toBeNull();
	});

	it("returns null when no saved session matches the resolved id (nothing in history to sync)", () => {
		expect(
			resolveRenamedSessionWrite(null, "sess-UNKNOWN", [saved], "X", NOW),
		).toBeNull();
	});
});
