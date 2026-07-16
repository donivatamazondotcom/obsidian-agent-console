import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		ItemView: class ItemView {},
	};
});
import { persistedToRuntime } from "../ChatView";
import type { PersistedTabInfo } from "../../types/tab";

function persistedTab(sessionId: string | null): PersistedTabInfo {
	return {
		tabId: "restored-tab",
		agentId: "kiro-cli",
		label: "Earlier chat",
		sessionId,
		tabOrder: 0,
		scrollPosition: 0,
	};
}

describe("persistedToRuntime — restored origin", () => {
	it.each(["saved-session", null])(
		"marks a persisted tab restored when sessionId is %s",
		(sessionId) => {
			const [tab] = persistedToRuntime([persistedTab(sessionId)]);
			expect(tab).toMatchObject({
				tabId: "restored-tab",
				origin: "restored",
				state: "disconnected",
			});
		},
	);
});
