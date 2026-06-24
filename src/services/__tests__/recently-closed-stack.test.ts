/**
 * Tests for the pure recently-closed-stack helpers (F13 — Undo Close Tab).
 * Covers LIFO ordering, depth cap, empty pop, and the skip-never-used
 * record builder.
 */

import { describe, it, expect, vi } from "vitest";
import {
	type ClosedTabRecord,
	type ClosedLeafRecord,
	RECENTLY_CLOSED_CAP,
	buildClosedTabRecord,
	buildClosedLeafRecord,
	popClosedTab,
	pushClosedTab,
	resolveRestoredLeaf,
} from "../recently-closed-stack";
import type { PerLeafTabState, PersistedTabInfo } from "../../types/tab";

function rec(sessionId: string, position = 0): ClosedTabRecord {
	return {
		sessionId,
		label: `label-${sessionId}`,
		labelIsCustom: false,
		agentId: "claude-code-acp",
		position,
	};
}

describe("recently-closed-stack", () => {
	describe("pushClosedTab / popClosedTab — LIFO", () => {
		it("pops the most-recently-pushed record first (LIFO)", () => {
			let stack: ClosedTabRecord[] = [];
			stack = pushClosedTab(stack, rec("A"));
			stack = pushClosedTab(stack, rec("B"));

			const first = popClosedTab(stack);
			expect(first.record?.sessionId).toBe("B"); // B closed last → reopens first
			const second = popClosedTab(first.stack);
			expect(second.record?.sessionId).toBe("A");
		});

		it("returns null record (and empty stack) when popping an empty stack", () => {
			const { record, stack } = popClosedTab([]);
			expect(record).toBeNull();
			expect(stack).toEqual([]);
		});

		it("does not mutate the input stack", () => {
			const original = [rec("A")];
			const pushed = pushClosedTab(original, rec("B"));
			expect(original).toHaveLength(1);
			expect(pushed).toHaveLength(2);

			const popped = popClosedTab(pushed);
			expect(pushed).toHaveLength(2);
			expect(popped.stack).toHaveLength(1);
		});
	});

	describe("depth cap", () => {
		it("drops the oldest entry when exceeding the cap", () => {
			let stack: ClosedTabRecord[] = [];
			for (let i = 0; i < RECENTLY_CLOSED_CAP + 5; i++) {
				stack = pushClosedTab(stack, rec(`s${i}`));
			}
			expect(stack).toHaveLength(RECENTLY_CLOSED_CAP);
			// Oldest (s0..s4) dropped; newest retained at the end.
			expect(stack[0].sessionId).toBe("s5");
			expect(stack[stack.length - 1].sessionId).toBe(
				`s${RECENTLY_CLOSED_CAP + 4}`,
			);
		});

		it("honors a custom cap", () => {
			let stack: ClosedTabRecord[] = [];
			stack = pushClosedTab(stack, rec("A"), 2);
			stack = pushClosedTab(stack, rec("B"), 2);
			stack = pushClosedTab(stack, rec("C"), 2);
			expect(stack.map((r) => r.sessionId)).toEqual(["B", "C"]);
		});
	});

	describe("buildClosedTabRecord — skip never-used tabs", () => {
		it("returns null when the tab never acquired a session", () => {
			const out = buildClosedTabRecord({
				tab: { agentId: "kiro", label: "blank" },
				sessionId: null,
				position: 2,
			});
			expect(out).toBeNull();
		});

		it("builds a full record for a tab with a session", () => {
			const out = buildClosedTabRecord({
				tab: { agentId: "kiro", label: "My chat", labelIsCustom: true },
				sessionId: "sess-123",
				position: 3,
			});
			expect(out).toEqual({
				sessionId: "sess-123",
				label: "My chat",
				labelIsCustom: true,
				agentId: "kiro",
				position: 3,
			});
		});

		it("defaults labelIsCustom to false when absent", () => {
			const out = buildClosedTabRecord({
				tab: { agentId: "kiro", label: "auto" },
				sessionId: "s",
				position: 0,
			});
			expect(out?.labelIsCustom).toBe(false);
		});
	});
});

// ============================================================================
// Leaf-granularity — reopen tabs on view reopen
// ([[ACP Restore Tabs on View Reopen]]). The same pure LIFO helpers serve a
// plugin-level stack of whole-leaf snapshots (survives leaf close), distinct
// from F13's per-leaf stack of single closed tabs.
// ============================================================================

function pTab(overrides: Partial<PersistedTabInfo> = {}): PersistedTabInfo {
	return {
		tabId: "T1",
		agentId: "claude-code-acp",
		label: "Tab 1",
		sessionId: "sess-1",
		tabOrder: 0,
		scrollPosition: 0,
		...overrides,
	};
}

function leaf(
	leafId: string,
	tabs: PersistedTabInfo[],
	activeTabId = tabs[0]?.tabId ?? "",
): ClosedLeafRecord {
	return { leafId, tabs, activeTabId };
}

describe("recently-closed-stack — leaf granularity", () => {
	describe("generic LIFO works for ClosedLeafRecord", () => {
		it("pops the most-recently-closed leaf first (LIFO)", () => {
			let stack: ClosedLeafRecord[] = [];
			stack = pushClosedTab(stack, leaf("leaf-A", [pTab({ tabId: "A1" })]));
			stack = pushClosedTab(stack, leaf("leaf-B", [pTab({ tabId: "B1" })]));

			const first = popClosedTab(stack);
			expect(first.record?.leafId).toBe("leaf-B"); // closed last → reopens first
			const second = popClosedTab(first.stack);
			expect(second.record?.leafId).toBe("leaf-A");
		});

		it("honors the depth cap with leaf records too", () => {
			let stack: ClosedLeafRecord[] = [];
			for (let i = 0; i < RECENTLY_CLOSED_CAP + 3; i++) {
				stack = pushClosedTab(stack, leaf(`leaf-${i}`, [pTab()]));
			}
			expect(stack).toHaveLength(RECENTLY_CLOSED_CAP);
			expect(stack[0].leafId).toBe("leaf-3");
		});
	});

	describe("buildClosedLeafRecord — worth-restoring gate", () => {
		it("returns null for a trivial single idle tab with no session and no draft", () => {
			const state = leaf("leaf-1", [
				pTab({ tabId: "T1", sessionId: null, draftText: "" }),
			]);
			expect(buildClosedLeafRecord(state)).toBeNull();
		});

		it("returns null for a single sessionless tab with omitted draftText", () => {
			const state = leaf("leaf-1", [pTab({ sessionId: null })]);
			delete (state.tabs[0] as Partial<PersistedTabInfo>).draftText;
			expect(buildClosedLeafRecord(state)).toBeNull();
		});

		it("returns null for an empty-tabs leaf", () => {
			expect(buildClosedLeafRecord(leaf("leaf-1", []))).toBeNull();
		});

		it("captures a single tab that has a session", () => {
			const state = leaf("leaf-1", [pTab({ sessionId: "S1" })]);
			expect(buildClosedLeafRecord(state)).toEqual(state);
		});

		it("captures a single sessionless tab that has unsent draft text", () => {
			const state = leaf("leaf-1", [
				pTab({ sessionId: null, draftText: "half-typed" }),
			]);
			expect(buildClosedLeafRecord(state)).toEqual(state);
		});

		it("captures a multi-tab leaf even when no tab has a session", () => {
			const state = leaf("leaf-1", [
				pTab({ tabId: "T1", sessionId: null, draftText: "" }),
				pTab({ tabId: "T2", sessionId: null, draftText: "" }),
			]);
			expect(buildClosedLeafRecord(state)).toEqual(state);
		});
	});

	describe("resolveRestoredLeaf — id-match wins; adopt only on mismatch", () => {
		it("returns the id-match and does NOT call adopt (no stack pop on restart)", () => {
			const idMatch: PerLeafTabState = leaf("leaf-1", [pTab()]);
			const adopt = vi.fn<() => PerLeafTabState | null>(() =>
				leaf("other", [pTab()]),
			);

			const result = resolveRestoredLeaf(idMatch, adopt);

			expect(result).toBe(idMatch);
			expect(adopt).not.toHaveBeenCalled();
		});

		it("adopts the recently-closed snapshot when there is no id-match", () => {
			const adopted: PerLeafTabState = leaf("leaf-A", [pTab()]);
			const adopt = vi.fn<() => PerLeafTabState | null>(() => adopted);

			const result = resolveRestoredLeaf(null, adopt);

			expect(result).toBe(adopted);
			expect(adopt).toHaveBeenCalledTimes(1);
		});

		it("returns null (fresh tab) when neither id-match nor stack has anything", () => {
			const adopt = vi.fn<() => PerLeafTabState | null>(() => null);
			expect(resolveRestoredLeaf(null, adopt)).toBeNull();
			expect(adopt).toHaveBeenCalledTimes(1);
		});
	});
});
