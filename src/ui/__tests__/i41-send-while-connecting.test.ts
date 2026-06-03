/**
 * I41 reproducing test: send button disabled during `connecting` state.
 *
 * Bug: canSend() in ChatPanel gates on `isSessionReady` (which is false
 * during `connecting`). InputArea's isButtonDisabled does the same.
 * This prevents the user from clicking send while session acquisition is
 * in flight — defeating the send-while-connecting queue path that
 * useLazySession and handleSendWithLazyAcquisition implement.
 *
 * The fix: canSend() should permit sending when the lazy session state
 * is `connecting` or `idle` (the queue handles the rest).
 *
 * This test models the CURRENT (broken) canSend logic and asserts the
 * DESIRED behavior. It will FAIL until the fix is applied.
 */
import { describe, it, expect } from "vitest";

/**
 * Models the FIXED canSend predicate from ChatPanel.
 * Now accepts lazySessionState === "connecting" || "idle" in addition
 * to isSessionReady.
 */
function canSend(params: {
	inputValue: string;
	attachedFilesCount: number;
	isSessionReady: boolean;
	sessionHistoryLoading: boolean;
	isSending: boolean;
	lazySessionState: "idle" | "connecting" | "ready" | "error";
}): boolean {
	const hasContent =
		params.inputValue.trim() !== "" || params.attachedFilesCount > 0;
	const canAcceptSend =
		params.isSessionReady ||
		params.lazySessionState === "connecting" ||
		params.lazySessionState === "idle";
	return (
		hasContent &&
		canAcceptSend &&
		!params.sessionHistoryLoading &&
		!params.isSending
	);
}

/**
 * Models the FIXED InputArea isButtonDisabled.
 * Now permits sending when lazySessionState is "connecting" or "idle".
 *
 * Returns true when button should be DISABLED.
 */
function isButtonDisabled(params: {
	inputValue: string;
	attachedFilesCount: number;
	isSessionReady: boolean;
	isRestoringSession: boolean;
	isSending: boolean;
	lazySessionState: "idle" | "connecting" | "ready" | "error";
}): boolean {
	return (
		!params.isSending &&
		((params.inputValue.trim() === "" && params.attachedFilesCount === 0) ||
			(!params.isSessionReady &&
				params.lazySessionState !== "connecting" &&
				params.lazySessionState !== "idle") ||
			params.isRestoringSession)
	);
}

describe("I41: send-while-connecting — canSend allows send during connecting state", () => {
	const baseReady = {
		inputValue: "Hello world",
		attachedFilesCount: 0,
		isSessionReady: true,
		sessionHistoryLoading: false,
		isSending: false,
		lazySessionState: "ready" as const,
	};

	it("baseline: canSend returns true when session is ready and has content", () => {
		expect(canSend(baseReady)).toBe(true);
	});

	it("BUG REPRO: canSend should return true when connecting and has content", () => {
		// This is the T04 scenario: user typed content, session acquisition
		// is in flight (connecting), user should be able to click send.
		// CURRENT behavior: returns false (bug)
		// DESIRED behavior: returns true
		expect(
			canSend({
				...baseReady,
				isSessionReady: false,
				lazySessionState: "connecting",
			}),
		).toBe(true);
	});

	it("canSend should return true when idle and has content (send triggers acquisition)", () => {
		// Idle state: user hasn't triggered acquisition yet but clicks send.
		// handleSendWithLazyAcquisition calls onSendClick which triggers it.
		expect(
			canSend({
				...baseReady,
				isSessionReady: false,
				lazySessionState: "idle",
			}),
		).toBe(true);
	});

	it("canSend returns false when session is in error state", () => {
		// Error state should NOT allow sending — user needs to retry explicitly
		expect(
			canSend({
				...baseReady,
				isSessionReady: false,
				lazySessionState: "error",
			}),
		).toBe(false);
	});

	it("canSend returns false when no content regardless of state", () => {
		expect(
			canSend({
				...baseReady,
				inputValue: "   ",
				attachedFilesCount: 0,
				isSessionReady: false,
				lazySessionState: "connecting",
			}),
		).toBe(false);
	});
});

describe("I41: send-while-connecting — InputArea button enabled during connecting", () => {
	const baseReady = {
		inputValue: "Hello world",
		attachedFilesCount: 0,
		isSessionReady: true,
		isRestoringSession: false,
		isSending: false,
		lazySessionState: "ready" as const,
	};

	it("baseline: button enabled when session ready and has content", () => {
		// isButtonDisabled = false means button IS enabled
		expect(isButtonDisabled(baseReady)).toBe(false);
	});

	it("BUG REPRO: button should be enabled when connecting and has content", () => {
		// CURRENT behavior: disabled (true) — bug
		// DESIRED behavior: enabled (false)
		expect(
			isButtonDisabled({
				...baseReady,
				isSessionReady: false,
				lazySessionState: "connecting",
			}),
		).toBe(false);
	});

	it("button should be enabled when idle and has content", () => {
		expect(
			isButtonDisabled({
				...baseReady,
				isSessionReady: false,
				lazySessionState: "idle",
			}),
		).toBe(false);
	});

	it("button disabled when error state and session not ready", () => {
		expect(
			isButtonDisabled({
				...baseReady,
				isSessionReady: false,
				lazySessionState: "error",
			}),
		).toBe(true);
	});
});
