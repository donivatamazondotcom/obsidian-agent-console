/**
 * Tests for the pure recently-closed-stack helpers (F13 — Undo Close Tab).
 * Covers LIFO ordering, depth cap, empty pop, and the skip-never-used
 * record builder.
 */

import { describe, it, expect } from "vitest";
import {
	type ClosedTabRecord,
	RECENTLY_CLOSED_CAP,
	buildClosedTabRecord,
	popClosedTab,
	pushClosedTab,
} from "../recently-closed-stack";

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
