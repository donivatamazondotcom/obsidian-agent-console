import { describe, it, expect, vi } from "vitest";
import { sendPreparedPrompt } from "../message-sender";
import type { AcpClient } from "../../acp/acp-client";
import type { PromptContent } from "../../types/chat";
import type { AuthenticationMethod } from "../../types/session";

/**
 * Mutation-audit coverage for the send half of message-sender:
 * sendPreparedPrompt → handleSendError → retryWithAuthentication.
 *
 * The 2026-07-31 baseline had this entire section (~70 mutants) at zero
 * coverage. Entry is the public sendPreparedPrompt seam — the exact call
 * useAgentMessages makes — with the AcpClient stubbed at the declared
 * acp/ port boundary (R4). Assertions are on the returned SendPromptResult
 * (the domain outcome the hook consumes) and, for the retry path, on the
 * content that went over the wire on the second attempt (R3).
 */

const CONTENT: PromptContent[] = [{ type: "text", text: "agent payload" }];
const DISPLAY: PromptContent[] = [{ type: "text", text: "shown" }];
const AUTH_ONE: AuthenticationMethod[] = [
	{ id: "oauth", name: "OAuth", description: null },
];
const AUTH_TWO: AuthenticationMethod[] = [
	{ id: "oauth", name: "OAuth", description: null },
	{ id: "api-key", name: "API key", description: null },
];

function baseInput(authMethods: AuthenticationMethod[] = []) {
	return {
		sessionId: "sess-1",
		agentContent: CONTENT,
		displayContent: DISPLAY,
		authMethods,
	};
}

function client(over: Partial<Record<"sendPrompt" | "authenticate", unknown>>) {
	return {
		sendPrompt: vi.fn().mockResolvedValue(undefined),
		authenticate: vi.fn().mockResolvedValue(true),
		...over,
	} as unknown as AcpClient;
}

const AUTH_ERROR = { code: -32000, message: "Authentication required" };

describe("sendPreparedPrompt — success and plain failure", () => {
	it("returns success with the original content when the send resolves", async () => {
		const c = client({});
		const r = await sendPreparedPrompt(baseInput(), c);
		expect(r).toEqual({
			success: true,
			displayContent: DISPLAY,
			agentContent: CONTENT,
		});
		expect(c.sendPrompt).toHaveBeenCalledWith("sess-1", CONTENT);
	});

	it("treats the 'empty response text' internal error as success (not a real error)", async () => {
		const c = client({
			sendPrompt: vi.fn().mockRejectedValue({
				code: -32603,
				message: "model returned empty response text",
			}),
		});
		const r = await sendPreparedPrompt(baseInput(), c);
		expect(r.success).toBe(true);
		expect(r.error).toBeUndefined();
	});

	it("surfaces any other internal error with the agent's own message preserved", async () => {
		const c = client({
			sendPrompt: vi.fn().mockRejectedValue({
				code: -32603,
				message: "model exploded",
			}),
		});
		const r = await sendPreparedPrompt(baseInput(), c);
		expect(r.success).toBe(false);
		expect(r.requiresAuth).toBeUndefined();
		expect(r.error?.code).toBe(-32603);
		expect(r.error?.message).toBe("model exploded");
		expect(r.error?.sessionId).toBe("sess-1");
		expect(r.displayContent).toBe(DISPLAY);
		expect(r.agentContent).toBe(CONTENT);
	});

	it("shows an auth error directly when the agent offers no auth methods", async () => {
		const c = client({
			sendPrompt: vi.fn().mockRejectedValue(AUTH_ERROR),
		});
		const r = await sendPreparedPrompt(baseInput([]), c);
		expect(r.success).toBe(false);
		expect(r.requiresAuth).toBeUndefined();
		expect(r.error?.code).toBe(-32000);
	});
});

describe("sendPreparedPrompt — authentication retry (-32000)", () => {
	it("retries automatically with a single auth method and reports retriedSuccessfully", async () => {
		const sendPrompt = vi
			.fn()
			.mockRejectedValueOnce(AUTH_ERROR)
			.mockResolvedValueOnce(undefined);
		const c = client({ sendPrompt });
		const r = await sendPreparedPrompt(baseInput(AUTH_ONE), c);
		expect(r).toEqual({
			success: true,
			displayContent: DISPLAY,
			agentContent: CONTENT,
			retriedSuccessfully: true,
		});
		expect(c.authenticate).toHaveBeenCalledWith("oauth");
		// the retry re-sent the SAME prepared content to the SAME session
		expect(sendPrompt).toHaveBeenNthCalledWith(2, "sess-1", CONTENT);
	});

	it("asks the user when authentication itself reports failure", async () => {
		const c = client({
			sendPrompt: vi.fn().mockRejectedValue(AUTH_ERROR),
			authenticate: vi.fn().mockResolvedValue(false),
		});
		const r = await sendPreparedPrompt(baseInput(AUTH_ONE), c);
		expect(r.success).toBe(false);
		expect(r.requiresAuth).toBe(true);
		expect(r.error?.code).toBe(-32000);
	});

	it("surfaces the retry error when the re-send fails after successful auth", async () => {
		const sendPrompt = vi
			.fn()
			.mockRejectedValueOnce(AUTH_ERROR)
			.mockRejectedValueOnce({ code: -32603, message: "still broken" });
		const c = client({ sendPrompt });
		const r = await sendPreparedPrompt(baseInput(AUTH_ONE), c);
		expect(r.success).toBe(false);
		expect(r.requiresAuth).toBeUndefined();
		expect(r.error?.message).toBe("still broken");
	});

	it("asks the user when the authenticate call throws", async () => {
		const c = client({
			sendPrompt: vi.fn().mockRejectedValue(AUTH_ERROR),
			authenticate: vi.fn().mockRejectedValue(new Error("auth crashed")),
		});
		const r = await sendPreparedPrompt(baseInput(AUTH_ONE), c);
		expect(r.success).toBe(false);
		expect(r.error?.message).toBe("auth crashed");
	});

	it("defers to user choice with multiple auth methods (no automatic retry)", async () => {
		const c = client({
			sendPrompt: vi.fn().mockRejectedValue(AUTH_ERROR),
		});
		const r = await sendPreparedPrompt(baseInput(AUTH_TWO), c);
		expect(r.success).toBe(false);
		expect(r.requiresAuth).toBe(true);
		expect(r.error?.code).toBe(-32000);
		expect(c.authenticate).not.toHaveBeenCalled();
	});
});

describe("sendPreparedPrompt — auth retry is gated on -32000 only (residual)", () => {
	it("does not attempt auth retry for a non-auth error even when a single auth method exists", async () => {
		const c = client({
			sendPrompt: vi.fn().mockRejectedValue({
				code: -32603,
				message: "internal failure",
			}),
		});
		const r = await sendPreparedPrompt(baseInput(AUTH_ONE), c);
		expect(r.success).toBe(false);
		expect(r.requiresAuth).toBeUndefined();
		expect(r.error?.code).toBe(-32603);
		expect(c.authenticate).not.toHaveBeenCalled();
		expect(c.sendPrompt).toHaveBeenCalledTimes(1);
	});
});
