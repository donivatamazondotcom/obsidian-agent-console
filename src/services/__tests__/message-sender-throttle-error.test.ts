import { describe, it, expect, vi } from "vitest";
import { sendPreparedPrompt } from "../message-sender";
import type { AcpClient } from "../../acp/acp-client";
import type { PromptContent } from "../../types/chat";
import type { AuthenticationMethod } from "../../types/session";

/**
 * I317: Kiro CLI V3 sends every user-facing service error (throttling, usage
 * limits, network faults) as JSON-RPC -32000 with the display message and an
 * `errorType` in `data` (`Nvo` in @kiro/agent acp-server.js, 3.1.2-nightly.4).
 * -32000 is also ACP's "auth required" code, so titling by code alone showed a
 * model throttle as "Authentication Required" and told the user to check their
 * login. A real auth request carries no `data.errorType`.
 *
 * THROTTLE_ERROR is the payload captured from the 11/09 failure (request ID
 * 0681cfb4-…, kiro.log + session messages.jsonl displayError).
 */

const CONTENT: PromptContent[] = [{ type: "text", text: "agent payload" }];
const DISPLAY: PromptContent[] = [{ type: "text", text: "shown" }];
const AUTH_ONE: AuthenticationMethod[] = [
	{ id: "oauth", name: "OAuth", description: null },
];

const THROTTLE_MESSAGE =
	"claude-opus-5.5 is experiencing high traffic. Try again, or select another model. (Request ID: 0681cfb4-ce86-4291-b2af-e7152d1d9026)";
const THROTTLE_ERROR = {
	code: -32000,
	message: THROTTLE_MESSAGE,
	data: {
		errorType: "ModelThrottleError",
		retryErrorType: "THROTTLING",
		requestId: "0681cfb4-ce86-4291-b2af-e7152d1d9026",
	},
};
const USAGE_LIMIT_ERROR = {
	code: -32000,
	message: "You've reached your monthly usage limit.",
	data: { errorType: "UsageLimitReachedError", retryErrorType: "CLIENT_ERROR" },
};
const AUTH_ERROR = { code: -32000, message: "Authentication required" };
// Kiro's own auth errors also carry data.errorType (acp-server.js,
// SignInRequiredError / ModelRegistryUnauthenticatedError). Review r1.
const SIGN_IN_ERROR = {
	code: -32000,
	message: "Sign in to Kiro to send a prompt.",
	data: { errorType: "SignInRequiredError", retryErrorType: "CLIENT_ERROR" },
};
const REGISTRY_UNAUTH_ERROR = {
	code: -32000,
	message:
		"Kiro could not load the available models because you are not signed in. Please sign in and retry.",
	data: {
		errorType: "ModelRegistryUnauthenticatedError",
		retryErrorType: "CLIENT_ERROR",
	},
};

function input(authMethods: AuthenticationMethod[] = []) {
	return {
		sessionId: "sess-1",
		agentContent: CONTENT,
		displayContent: DISPLAY,
		authMethods,
	};
}

function client(error: unknown) {
	return {
		sendPrompt: vi.fn().mockRejectedValue(error),
		authenticate: vi.fn().mockResolvedValue(true),
	} as unknown as AcpClient;
}

describe("I317: a Kiro service error on -32000 is not an auth error", () => {
	it("titles a throttle error as busy, with the agent's message and a wait-and-retry suggestion", async () => {
		const r = await sendPreparedPrompt(input(), client(THROTTLE_ERROR));
		expect(r.success).toBe(false);
		expect(r.error?.title).toBe("Service Busy");
		expect(r.error?.message).toBe(THROTTLE_MESSAGE);
		expect(r.error?.suggestion).toBe(
			"The service is busy. Please wait a moment and try again.",
		);
	});

	it("titles another Kiro service error as an agent error, not auth", async () => {
		const r = await sendPreparedPrompt(input(), client(USAGE_LIMIT_ERROR));
		expect(r.error?.title).toBe("Agent Error");
		expect(r.error?.suggestion).not.toMatch(/logged in|API key/);
	});

	it("does not authenticate or resend a throttle error, even with a single auth method", async () => {
		const c = client(THROTTLE_ERROR);
		const r = await sendPreparedPrompt(input(AUTH_ONE), c);
		expect(c.authenticate).not.toHaveBeenCalled();
		expect(c.sendPrompt).toHaveBeenCalledTimes(1);
		expect(r.requiresAuth).toBeUndefined();
		expect(r.error?.title).toBe("Service Busy");
	});

	it.each([
		["SignInRequiredError", SIGN_IN_ERROR],
		["ModelRegistryUnauthenticatedError", REGISTRY_UNAUTH_ERROR],
	])("keeps Kiro's %s on the auth path (title, suggestion, retry)", async (_name, error) => {
		const r = await sendPreparedPrompt(input(), client(error));
		expect(r.error?.title).toBe("Authentication Required");
		expect(r.error?.suggestion).toBe(
			"Check if you are logged in or if your API key is set correctly.",
		);
		const c = client(error);
		await sendPreparedPrompt(input(AUTH_ONE), c);
		expect(c.authenticate).toHaveBeenCalledWith("oauth");
	});

	it.each([
		// HTTP 407: Kiro's message says to check the proxy, not to sign in. Review r2.
		["ProxyAuthenticationRequiredError", "TRANSIENT"],
		// "Token" for a reason other than credentials.
		["TokenEstimationError", "CLIENT_ERROR"],
	])("keeps %s a service error (no auth title, no auth retry)", async (errorType, retryErrorType) => {
		const error = {
			code: -32000,
			message: "Check your proxy settings.",
			data: { errorType, retryErrorType },
		};
		const c = client(error);
		const r = await sendPreparedPrompt(input(AUTH_ONE), c);
		expect(r.error?.title).toBe("Agent Error");
		expect(c.authenticate).not.toHaveBeenCalled();
	});

	it("treats a ThrottleError class as busy even without retryErrorType", async () => {
		const r = await sendPreparedPrompt(
			input(),
			client({
				code: -32000,
				message: "Too many requests.",
				data: { errorType: "ServiceThrottleError" },
			}),
		);
		expect(r.error?.title).toBe("Service Busy");
	});

	it("titles THROTTLING as busy on any error code, by design", async () => {
		const r = await sendPreparedPrompt(
			input(),
			client({
				code: -32603,
				message: "Slow down.",
				data: { retryErrorType: "THROTTLING" },
			}),
		);
		expect(r.error?.title).toBe("Service Busy");
	});

	it("still titles a real auth request (no errorType) as Authentication Required", async () => {
		const r = await sendPreparedPrompt(input(), client(AUTH_ERROR));
		expect(r.error?.title).toBe("Authentication Required");
		expect(r.error?.suggestion).toBe(
			"Check if you are logged in or if your API key is set correctly.",
		);
	});
});
