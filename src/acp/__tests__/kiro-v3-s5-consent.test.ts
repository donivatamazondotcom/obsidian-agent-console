/**
 * Kiro CLI V3 S5: persistent permission choices return canonical consent.
 *
 * Verified live on 2.34.3-nightly.3 (2026-11-01, Q2): with no
 * `_meta.kiro.consent` in the reply, "Always allow" already persists for the
 * current chat and the exact resource — the server defaults scope to
 * "session". The guide (§5, §9) still asks a Kiro-aware client to return the
 * consent explicitly for persistent options, so the plugin sends exactly the
 * server's default: scope "session", the request's resource, its workspace
 * root. One-time options send nothing. Requests without consent context (V2)
 * are answered exactly as before.
 *
 * Spec: [[Kiro CLI V3 Support]] § S5.
 */
import { describe, expect, it, vi } from "vitest";
import * as acp from "@agentclientprotocol/sdk";

import { PermissionManager } from "../permission-handler";
import { kiroConsentForChoice, clientShellType } from "../kiro-v3";
import { AcpHandler } from "../acp-handler";
import { registerClientHandlers } from "../acp-client";
import type { TerminalManager } from "../terminal-handler";
import type { Logger } from "../../utils/logger";
import type { SessionUpdate } from "../../types/session";

const OPTIONS: acp.PermissionOption[] = [
	{ optionId: "accept", name: "Allow", kind: "allow_once" },
	{ optionId: "always-accept", name: "Always allow", kind: "allow_always" },
	{ optionId: "reject", name: "Deny", kind: "reject_once" },
	{ optionId: "always-reject", name: "Always deny", kind: "reject_always" },
];

const V3_CONSENT = {
	capability: "shell",
	resource: "npm run test",
	triggeringResource: "npm run test",
	workspaceRoot: "/vault",
	askType: "implicit",
};

function v3Request(consent: Record<string, unknown> = V3_CONSENT): acp.RequestPermissionRequest {
	return {
		sessionId: "s1",
		toolCall: { toolCallId: "call-1", title: "npm run test", status: "pending" },
		options: OPTIONS,
		_meta: { kiro: { consent } },
	} as acp.RequestPermissionRequest;
}

function v2Request(): acp.RequestPermissionRequest {
	return {
		sessionId: "s1",
		toolCall: { toolCallId: "call-1", title: "npm run test", status: "pending" },
		options: OPTIONS,
		_meta: { trustOptions: [{ id: "t", label: "Trust" }] },
	} as unknown as acp.RequestPermissionRequest;
}

function makeManager(autoAllow = false) {
	const updates: SessionUpdate[] = [];
	const manager = new PermissionManager({ onSessionUpdate: (u) => updates.push(u) }, autoAllow);
	return { manager, updates };
}

/** Ask, then answer with `optionId` through the same path the UI uses. */
async function answer(
	request: acp.RequestPermissionRequest,
	optionId: string,
): Promise<acp.RequestPermissionResponse> {
	const { manager, updates } = makeManager();
	const pending = manager.request(request);
	const shown = updates.find((u) => u.type === "tool_call") as Extract<SessionUpdate, { type: "tool_call" }>;
	manager.respond(shown.permissionRequest!.requestId, optionId);
	return pending;
}

describe("V3: persistent choices return canonical consent", () => {
	it("Always allow → selected option + session-scoped consent for the request's resource", async () => {
		await expect(answer(v3Request(), "always-accept")).resolves.toEqual({
			outcome: { outcome: "selected", optionId: "always-accept" },
			_meta: { kiro: { consent: { scope: "session", resource: "npm run test", workspaceRoot: "/vault" } } },
		});
	});

	it("Always deny gets the same consent shape", async () => {
		const res = await answer(v3Request(), "always-reject");
		expect(res.outcome).toEqual({ outcome: "selected", optionId: "always-reject" });
		expect(res._meta).toEqual({
			kiro: { consent: { scope: "session", resource: "npm run test", workspaceRoot: "/vault" } },
		});
	});

	it("uses the triggering resource when it differs from the gated one (as the server does)", async () => {
		const res = await answer(
			v3Request({ ...V3_CONSENT, resource: "npm", triggeringResource: "npm run lint" }),
			"always-accept",
		);
		expect(res._meta).toEqual({
			kiro: { consent: { scope: "session", resource: "npm run lint", workspaceRoot: "/vault" } },
		});
	});

	it.each(["accept", "reject"])("a one-time choice (%s) sends no consent", async (optionId) => {
		const res = await answer(v3Request(), optionId);
		expect(res).toEqual({ outcome: { outcome: "selected", optionId } });
	});

	it("sends no consent when the server says the choice can't be persisted", async () => {
		const res = await answer(v3Request({ ...V3_CONSENT, persistableConsent: false }), "always-accept");
		expect(res).toEqual({ outcome: { outcome: "selected", optionId: "always-accept" } });
	});

	it("omits workspaceRoot when the server sent none", async () => {
		const { workspaceRoot: _omit, ...noRoot } = V3_CONSENT;
		const res = await answer(v3Request(noRoot), "always-accept");
		expect(res._meta).toEqual({ kiro: { consent: { scope: "session", resource: "npm run test" } } });
	});
});

describe("V2 and auto-allow are unchanged", () => {
	it("V2: a request without consent context gets no _meta", async () => {
		await expect(answer(v2Request(), "always-accept")).resolves.toEqual({
			outcome: { outcome: "selected", optionId: "always-accept" },
		});
	});

	it("auto-allow answers the one-time allow with no consent, even on V3", async () => {
		const { manager } = makeManager(true);
		await expect(manager.request(v3Request())).resolves.toEqual({
			outcome: { outcome: "selected", optionId: "accept" },
		});
	});
});

describe("the UI learns that a persistent choice lasts for this chat", () => {
	it("V3: persistent options are marked chat-scoped; one-time options aren't", () => {
		const { manager, updates } = makeManager();
		void manager.request(v3Request());
		const shown = updates.find((u) => u.type === "tool_call") as Extract<SessionUpdate, { type: "tool_call" }>;
		const scopes = Object.fromEntries(shown.permissionRequest!.options.map((o) => [o.optionId, o.persistsFor]));
		expect(scopes).toEqual({ accept: undefined, "always-accept": "chat", reject: undefined, "always-reject": "chat" });
	});

	it("V2: no option is marked", () => {
		const { manager, updates } = makeManager();
		void manager.request(v2Request());
		const shown = updates.find((u) => u.type === "tool_call") as Extract<SessionUpdate, { type: "tool_call" }>;
		expect(shown.permissionRequest!.options.every((o) => o.persistsFor === undefined)).toBe(true);
	});
});

describe("kiroConsentForChoice", () => {
	it("is undefined without consent context or for a non-persistent kind", () => {
		expect(kiroConsentForChoice("allow_always", undefined)).toBeUndefined();
		expect(kiroConsentForChoice("allow_once", { kiro: { consent: V3_CONSENT } })).toBeUndefined();
	});
	it("ignores malformed consent context instead of guessing", () => {
		expect(kiroConsentForChoice("allow_always", { kiro: { consent: { resource: 7 } } })).toBeUndefined();
		expect(kiroConsentForChoice("allow_always", { kiro: { consent: "x" } })).toBeUndefined();
	});
	it("logs nothing", () => {
		const spy = vi.spyOn(console, "log");
		kiroConsentForChoice("allow_always", { kiro: { consent: V3_CONSENT } });
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});

// Found in the S5 smoke (2026-11-01): with `terminal: true`, Kiro asks the
// client which shell its terminals use (`_kiro/terminal/shell_type`, read in
// the 2.34.3-nightly.3 bundle). Unanswered, the shell is "unknown", Kiro
// can't verify a saved rule would match, and it offers only Allow / Deny.
describe("V3: Kiro learns which shell Agent Console's terminals use", () => {
	it("clientShellType names the shell the terminal handler spawns", () => {
		expect(clientShellType({ platform: "darwin", loginShell: "/bin/zsh", wslMode: false })).toBe("zsh");
		expect(clientShellType({ platform: "linux", loginShell: "/usr/bin/bash", wslMode: false })).toBe("bash");
		expect(clientShellType({ platform: "win32", loginShell: "", wslMode: true })).toBe("wsl");
		expect(clientShellType({ platform: "win32", loginShell: "", wslMode: false })).toBe("cmd");
	});

	it("answers _kiro/terminal/shell_type over the real handler wiring", async () => {
		const logger = { log() {}, warn() {}, error() {}, debug() {}, info() {} } as unknown as Logger;
		const handler = new AcpHandler(
			new PermissionManager({ onSessionUpdate: () => {} }, false),
			{} as TerminalManager,
			() => "/vault",
			() => "s1",
			logger,
			() => "zsh",
		);
		let agentSide: acp.AgentContext | undefined;
		const agentApp = acp.agent().onConnect((c) => {
			agentSide = c.client;
		});
		registerClientHandlers(acp.client({ name: "agent-console" }), handler).connect(agentApp);
		await vi.waitFor(() => expect(agentSide).toBeDefined());
		await expect(agentSide!.request("_kiro/terminal/shell_type", { sessionId: "s1" })).resolves.toEqual({
			shellType: "zsh",
		});
	});
});

