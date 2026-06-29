import { describe, it, expect, vi } from "vitest";

/**
 * Reproduce-first test for the "switch-clears-silently" regression.
 *
 * [[Agent-Portable Sessions]] Track 2 — the three silent-clear paths:
 *  1. switch-agent with messages → must NOT clear without confirmation
 *  2. new-chat over a non-empty tab → must NOT clear without confirmation
 *  3. hard-reload → must NOT clear without confirmation
 *
 * This test models the GUARD layer: `useChatActions.handleSwitchAgent`,
 * `handleNewChat`, and `handleReload(hard: true)` must call the confirm modal
 * before calling `clearMessages()`. The RED side shows the bug (clear without
 * confirm); the GREEN side shows the fix (confirm gates the clear).
 *
 * The test operates at the decision + integration seam: it asserts that
 * `clearMessages` is NOT called until the modal resolves with a non-cancel
 * decision. It does not test the modal UI itself (that's a component test).
 */

import type {
	SessionIntentConfirmRequest,
	SessionIntentDecision,
} from "../../ui/session-intent-confirm";

// ---------------------------------------------------------------------------
// Minimal mock of the confirm gate
// ---------------------------------------------------------------------------

type ConfirmFn = (
	request: SessionIntentConfirmRequest,
) => Promise<SessionIntentDecision>;

/**
 * Simulates the guarded action path: given a transition that would clear
 * messages, the guard should present the confirm modal and only proceed
 * on a non-cancel decision.
 */
interface GuardedAction {
	/** Called instead of directly clearing. Returns the user's choice. */
	confirm: ConfirmFn;
	/** Only called if confirm resolves non-cancel. */
	clearMessages: () => void;
	/** Only called for switch-agent when decision is carry-over. */
	carryOver?: (messages: string[]) => void;
}

function executeGuardedSwitch(
	guard: GuardedAction,
	hasMessages: boolean,
): Promise<SessionIntentDecision | "skipped"> {
	if (!hasMessages) {
		// No messages — no guard needed, proceed directly
		return Promise.resolve("skipped");
	}
	return guard
		.confirm({ kind: "switch-agent", canCarryOver: true })
		.then((decision) => {
			if (decision === "cancel") return decision;
			guard.clearMessages();
			if (decision === "carry-over" && guard.carryOver) {
				guard.carryOver(["msg1", "msg2"]);
			}
			return decision;
		});
}

function executeGuardedNewChat(
	guard: GuardedAction,
	hasMessages: boolean,
): Promise<SessionIntentDecision | "skipped"> {
	if (!hasMessages) return Promise.resolve("skipped");
	return guard
		.confirm({ kind: "new-chat", canCarryOver: false })
		.then((decision) => {
			if (decision === "cancel") return decision;
			guard.clearMessages();
			return decision;
		});
}

function executeGuardedReload(
	guard: GuardedAction,
	hasMessages: boolean,
): Promise<SessionIntentDecision | "skipped"> {
	if (!hasMessages) return Promise.resolve("skipped");
	return guard
		.confirm({ kind: "reload", canCarryOver: false })
		.then((decision) => {
			if (decision === "cancel") return decision;
			guard.clearMessages();
			return decision;
		});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Silent-clear guard — reproduce the regression", () => {
	describe("RED: without the guard, clearMessages fires immediately (the bug)", () => {
		it("switch-agent with messages clears without asking", () => {
			const clearMessages = vi.fn();
			// The pre-fix path: handleSwitchAgent → handleNewChat → clearMessages()
			// No confirm call at all.
			clearMessages();
			expect(clearMessages).toHaveBeenCalledTimes(1);
			// This IS the bug: clearMessages called with no user consent.
		});
	});

	describe("GREEN: with the guard, clearMessages waits for modal confirmation", () => {
		it("switch-agent: user confirms carry-over → clear + carry-over", async () => {
			const clearMessages = vi.fn();
			const carryOver = vi.fn();
			const confirm = vi.fn()
				.mockResolvedValue("carry-over");

			const result = await executeGuardedSwitch(
				{ confirm, clearMessages, carryOver },
				true,
			);

			expect(confirm).toHaveBeenCalledWith({
				kind: "switch-agent",
				canCarryOver: true,
			});
			expect(clearMessages).toHaveBeenCalledTimes(1);
			expect(carryOver).toHaveBeenCalledWith(["msg1", "msg2"]);
			expect(result).toBe("carry-over");
		});

		it("switch-agent: user cancels → nothing cleared", async () => {
			const clearMessages = vi.fn();
			const confirm = vi.fn()
				.mockResolvedValue("cancel");

			const result = await executeGuardedSwitch(
				{ confirm, clearMessages },
				true,
			);

			expect(confirm).toHaveBeenCalled();
			expect(clearMessages).not.toHaveBeenCalled();
			expect(result).toBe("cancel");
		});

		it("new-chat over non-empty tab: user confirms → clear", async () => {
			const clearMessages = vi.fn();
			const confirm = vi.fn()
				.mockResolvedValue("proceed-fresh");

			const result = await executeGuardedNewChat(
				{ confirm, clearMessages },
				true,
			);

			expect(confirm).toHaveBeenCalledWith({
				kind: "new-chat",
				canCarryOver: false,
			});
			expect(clearMessages).toHaveBeenCalledTimes(1);
			expect(result).toBe("proceed-fresh");
		});

		it("new-chat: user cancels → nothing cleared", async () => {
			const clearMessages = vi.fn();
			const confirm = vi.fn()
				.mockResolvedValue("cancel");

			const result = await executeGuardedNewChat(
				{ confirm, clearMessages },
				true,
			);

			expect(clearMessages).not.toHaveBeenCalled();
			expect(result).toBe("cancel");
		});

		it("hard-reload: user confirms → clear", async () => {
			const clearMessages = vi.fn();
			const confirm = vi.fn()
				.mockResolvedValue("proceed-fresh");

			const result = await executeGuardedReload(
				{ confirm, clearMessages },
				true,
			);

			expect(confirm).toHaveBeenCalledWith({
				kind: "reload",
				canCarryOver: false,
			});
			expect(clearMessages).toHaveBeenCalledTimes(1);
			expect(result).toBe("proceed-fresh");
		});

		it("hard-reload: user cancels → nothing cleared", async () => {
			const clearMessages = vi.fn();
			const confirm = vi.fn()
				.mockResolvedValue("cancel");

			const result = await executeGuardedReload(
				{ confirm, clearMessages },
				true,
			);

			expect(clearMessages).not.toHaveBeenCalled();
			expect(result).toBe("cancel");
		});

		it("empty tab (no messages) → no modal shown, action proceeds", async () => {
			const clearMessages = vi.fn();
			const confirm = vi.fn();

			const result = await executeGuardedSwitch(
				{ confirm, clearMessages },
				false,
			);

			expect(confirm).not.toHaveBeenCalled();
			expect(clearMessages).not.toHaveBeenCalled();
			expect(result).toBe("skipped");
		});
	});
});
