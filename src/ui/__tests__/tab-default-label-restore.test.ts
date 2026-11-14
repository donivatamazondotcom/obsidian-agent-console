/**
 * The "still has its default name" flag survives a restart and a reopened tab
 * (Session Title in the Chat Header, Test 8, restore half).
 *
 * Restart and the adopted closed panel restore through `persistedToRuntime`.
 * It reads the flag with a logging parse: true → true; absent (every tab saved
 * before this change) → false, no log; anything else → logged and false. A bad
 * value never fails the rest of the panel's tabs. Reopen-closed-tab carries
 * the flag through `buildClosedTabRecord`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, ItemView: class ItemView {} };
});

import { persistedToRuntime } from "../ChatView";
import { buildClosedTabRecord } from "../../services/recently-closed-stack";
import { Logger } from "../../utils/logger";
import type { PersistedTabInfo } from "../../types/tab";

function persisted(id: string, extra: Record<string, unknown> = {}): PersistedTabInfo {
	return {
		tabId: id,
		agentId: "claude-code-acp",
		label: "Claude Code 08:14 AM",
		sessionId: null,
		tabOrder: 0,
		scrollPosition: 0,
		...extra,
	} as PersistedTabInfo;
}

afterEach(() => vi.restoreAllMocks());

describe("persistedToRuntime reads labelIsDefault", () => {
	it("true restores as true", () => {
		const [t] = persistedToRuntime([persisted("A", { labelIsDefault: true })]);
		expect(t.labelIsDefault).toBe(true);
	});

	it("absent restores as false with no log (tabs saved before this change)", () => {
		const warn = vi.spyOn(Logger.prototype, "warn");
		const [t] = persistedToRuntime([persisted("A")]);
		expect(t.labelIsDefault).toBe(false);
		expect(warn).not.toHaveBeenCalled();
	});

	it("a non-boolean value is logged and read as false; the other tabs still restore", () => {
		const warn = vi.spyOn(Logger.prototype, "warn");
		const tabs = persistedToRuntime([
			persisted("A", { labelIsDefault: "yes" }),
			persisted("B", { labelIsDefault: true }),
		]);
		expect(tabs.map((t) => [t.tabId, t.labelIsDefault])).toEqual([
			["A", false],
			["B", true],
		]);
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

describe("buildClosedTabRecord carries labelIsDefault", () => {
	it("a closed default-named tab keeps the flag", () => {
		const record = buildClosedTabRecord({
			tab: { agentId: "claude-code-acp", label: "Claude Code 08:14 AM", labelIsDefault: true },
			sessionId: "S1",
			position: 0,
		});
		expect(record?.labelIsDefault).toBe(true);
	});

	it("a closed renamed tab isn't flagged (the key is written only when true)", () => {
		const record = buildClosedTabRecord({
			tab: { agentId: "claude-code-acp", label: "Debug CI", labelIsDefault: false },
			sessionId: "S1",
			position: 0,
		});
		expect(record).not.toBeNull();
		expect("labelIsDefault" in (record as object)).toBe(false);
	});
});
