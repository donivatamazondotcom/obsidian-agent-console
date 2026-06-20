/**
 * Command-palette rationalization (v1.2.0) — decision-logic tests.
 *
 * Covers the pure logic behind the test cases in
 * [[Agent Console Command Palette Rationalization]]:
 *   T2  New chat works from any state
 *   T3  New chat with agent from cold start (no no-op — the I82 fix)
 *   T1/T4  Context commands gate on an open chat view
 *
 * Palette *rendering* (whether a command actually appears/filters) is an
 * Obsidian-runtime concern with no unit-test seam, verified manually; this
 * suite pins the decisions those behaviors are built on.
 */

import { describe, it, expect } from "vitest";
import {
	computeStartChat,
	isChatCommandAvailable,
} from "../command-palette";

describe("computeStartChat", () => {
	// T2: New chat from a cold start (no chat view) opens a panel — never a
	// no-op (the I82 bug class). Default agent when none requested.
	it("opens a panel when no chat view exists and no agent requested", () => {
		expect(computeStartChat(false)).toEqual({
			kind: "open-panel",
			agentId: undefined,
		});
	});

	// T3: New chat with agent from a cold start opens a panel ON that agent.
	it("opens a panel on the requested agent when no chat view exists", () => {
		expect(computeStartChat(false, "kiro-cli")).toEqual({
			kind: "open-panel",
			agentId: "kiro-cli",
		});
	});

	// T2 (browser-tab model): with a chat view open, "New chat" opens a NEW
	// tab — not a reset-in-place (which would overlap with Hard reload).
	it("opens a new tab when a chat view exists and no agent requested", () => {
		expect(computeStartChat(true)).toEqual({
			kind: "add-tab",
			agentId: undefined,
		});
	});

	// T3 step 2 / picker while open: a new tab on the chosen agent.
	it("opens a new tab on the chosen agent when a chat view exists", () => {
		expect(computeStartChat(true, "codex")).toEqual({
			kind: "add-tab",
			agentId: "codex",
		});
	});

	// I82 invariant: the no-view case always opens a panel (a visible chat) —
	// it is never a dispatch/no-op.
	it("always opens a panel (never a no-op) when no chat view exists", () => {
		expect(computeStartChat(false).kind).toBe("open-panel");
		expect(computeStartChat(false, "gemini").kind).toBe("open-panel");
	});

	// Consistency guard (the duplicate-tab fix): the action is decided by
	// existence alone, identical regardless of the agent argument's presence.
	it("picks the action by chat-view existence, not focus state", () => {
		expect(computeStartChat(true).kind).toBe("add-tab");
		expect(computeStartChat(true, "x").kind).toBe("add-tab");
		expect(computeStartChat(false).kind).toBe("open-panel");
		expect(computeStartChat(false, "x").kind).toBe("open-panel");
	});
});

describe("isChatCommandAvailable", () => {
	// T1/T4: cold start (zero chat views) hides the navigate/act/broadcast
	// commands; once a chat view is open they become available.
	it("is false when no chat view is open", () => {
		expect(isChatCommandAvailable(0)).toBe(false);
	});

	it("is true when at least one chat view is open", () => {
		expect(isChatCommandAvailable(1)).toBe(true);
		expect(isChatCommandAvailable(3)).toBe(true);
	});
});
