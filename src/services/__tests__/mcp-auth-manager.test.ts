/**
 * MCP OAuth prompt surfacing — boundary + manager tests.
 *
 * Spec: 04-initiatives/Agent Console/MCP OAuth Prompt Surfacing.md
 * - T01 parser normalizes oauth_request; malformed payloads throw (drop, never coerce)
 * - T02 parser normalizes server_initialized
 * - T03 auth events bypass the I108 session filter (no session-id gating)
 * - T04 manager: request → pending; initialized → cleared; queue order kept
 * - T05 manager: pending state survives Notice dismissal (command re-lists)
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("obsidian", () => import("../../__test_stubs__/obsidian"));

import {
	parseMcpOauthRequest,
	parseMcpServerInitialized,
} from "../../acp/mcp-auth-parsers";
import { AcpHandler } from "../../acp/acp-handler";
import {
	McpAuthManager,
	createMcpAuthState,
	reduceMcpAuth,
	oauthUrlHost,
} from "../mcp-auth-manager";
import type { McpAuthEvent } from "../../types/mcp-auth";
import { Notice } from "../../__test_stubs__/obsidian";

const OAUTH_PARAMS = {
	sessionId: "sess-1",
	serverName: "sheets",
	oauthUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=abc",
};

// ---------------------------------------------------------------------------
// T01 / T02 — boundary parsers
// ---------------------------------------------------------------------------

describe("mcp-auth-parsers", () => {
	it("T01: normalizes a well-formed oauth_request payload", () => {
		expect(parseMcpOauthRequest(OAUTH_PARAMS)).toEqual(OAUTH_PARAMS);
	});

	it.each([
		["missing oauthUrl", { sessionId: "s", serverName: "n" }],
		["missing serverName", { sessionId: "s", oauthUrl: "https://x" }],
		["empty serverName", { sessionId: "s", serverName: "", oauthUrl: "u" }],
		[
			"non-string oauthUrl",
			{ sessionId: "s", serverName: "n", oauthUrl: 7 },
		],
		["null params", null],
		["string params", "nope"],
	])("T01: throws on malformed oauth_request (%s)", (_label, params) => {
		expect(() => parseMcpOauthRequest(params)).toThrow(/Malformed/);
	});

	it("T02: normalizes a well-formed server_initialized payload", () => {
		expect(
			parseMcpServerInitialized({ sessionId: "s1", serverName: "drive" }),
		).toEqual({ sessionId: "s1", serverName: "drive" });
	});

	it("T02: throws on malformed server_initialized", () => {
		expect(() => parseMcpServerInitialized({ sessionId: "s1" })).toThrow(
			/Malformed/,
		);
	});
});

// ---------------------------------------------------------------------------
// T03 — handler channel bypasses the session filter
// ---------------------------------------------------------------------------

function makeHandler(currentSessionId: string | null): AcpHandler {
	const logger = {
		log: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
	return new AcpHandler(
		// permissionManager / terminalManager are not exercised here
		{} as never,
		{} as never,
		() => "/tmp",
		() => currentSessionId,
		logger as never,
	);
}

describe("AcpHandler MCP auth channel", () => {
	it("T03: delivers oauth_request even when no session is committed yet", () => {
		// currentSessionId null = the window before session/new resolves —
		// emitSessionUpdate would drop a session-tagged update here (I108).
		const handler = makeHandler(null);
		const events: McpAuthEvent[] = [];
		handler.onMcpAuthEvent((e) => events.push(e));

		handler.mcpOauthRequest(OAUTH_PARAMS);

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			kind: "oauth_request",
			serverName: "sheets",
			oauthUrl: OAUTH_PARAMS.oauthUrl,
		});
	});

	it("T03: delivers events for a non-current session id (no filtering)", () => {
		const handler = makeHandler("some-other-session");
		const events: McpAuthEvent[] = [];
		handler.onMcpAuthEvent((e) => events.push(e));

		handler.mcpServerInitialized({ sessionId: "sess-1", serverName: "x" });

		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("server_initialized");
	});

	it("unsubscribe stops delivery", () => {
		const handler = makeHandler(null);
		const events: McpAuthEvent[] = [];
		const unsubscribe = handler.onMcpAuthEvent((e) => events.push(e));
		unsubscribe();
		handler.mcpOauthRequest(OAUTH_PARAMS);
		expect(events).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// T04 / T05 — manager state + Notice lifecycle
// ---------------------------------------------------------------------------

/** Minimal fake client exposing the McpAuthEvent channel. */
function makeFakeClient() {
	const listeners = new Set<(e: McpAuthEvent) => void>();
	return {
		onMcpAuthEvent(cb: (e: McpAuthEvent) => void) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		emit(e: McpAuthEvent) {
			for (const cb of listeners) cb(e);
		},
	};
}

const oauthEvent = (serverName: string): McpAuthEvent => ({
	kind: "oauth_request",
	sessionId: "sess-1",
	serverName,
	oauthUrl: `https://accounts.google.com/auth?server=${serverName}`,
});

const initializedEvent = (serverName: string): McpAuthEvent => ({
	kind: "server_initialized",
	sessionId: "sess-1",
	serverName,
});

describe("McpAuthManager", () => {
	beforeEach(() => {
		Notice.instances = [];
	});

	it("T04: oauth_request adds pending; server_initialized clears it", () => {
		const manager = new McpAuthManager();
		const client = makeFakeClient();
		manager.trackClient("view-1", client);

		client.emit(oauthEvent("sheets"));
		expect(manager.getPending().map((p) => p.serverName)).toEqual([
			"sheets",
		]);

		client.emit(initializedEvent("sheets"));
		expect(manager.getPending()).toEqual([]);
	});

	it("T04: multiple servers queue in arrival order", () => {
		const manager = new McpAuthManager();
		const client = makeFakeClient();
		manager.trackClient("view-1", client);

		client.emit(oauthEvent("sheets"));
		client.emit(oauthEvent("drive"));
		client.emit(oauthEvent("gmail"));

		expect(manager.getPending().map((p) => p.serverName)).toEqual([
			"sheets",
			"drive",
			"gmail",
		]);

		client.emit(initializedEvent("sheets"));
		expect(manager.getPending().map((p) => p.serverName)).toEqual([
			"drive",
			"gmail",
		]);
	});

	it("T04: server_initialized without a prior request is a no-op", () => {
		const manager = new McpAuthManager();
		const client = makeFakeClient();
		manager.trackClient("view-1", client);

		client.emit(initializedEvent("schwab"));
		expect(manager.getPending()).toEqual([]);
		expect(Notice.instances).toHaveLength(0);
	});

	it("T04: queue-aware Notice — one Notice, replaced on change, hidden when empty", () => {
		const manager = new McpAuthManager();
		const client = makeFakeClient();
		manager.trackClient("view-1", client);

		client.emit(oauthEvent("sheets"));
		client.emit(oauthEvent("drive"));
		// Every state change re-renders: the previous Notice is hidden.
		const live = Notice.instances.filter((n) => !n.hidden);
		expect(live).toHaveLength(1);
		expect(live[0].duration).toBe(0); // persistent

		client.emit(initializedEvent("sheets"));
		client.emit(initializedEvent("drive"));
		// Queue empty → silent dismissal, no success popup.
		expect(Notice.instances.every((n) => n.hidden)).toBe(true);
	});

	it("T05: pending state is queryable independent of the Notice", () => {
		const manager = new McpAuthManager();
		const client = makeFakeClient();
		manager.trackClient("view-1", client);

		client.emit(oauthEvent("sheets"));
		// Simulate the user dismissing the Notice — state must survive.
		for (const n of Notice.instances) n.hide();

		expect(manager.getPending().map((p) => p.serverName)).toEqual([
			"sheets",
		]);
		expect(manager.getPendingForServer("sheets")?.host).toBe(
			"accounts.google.com",
		);
	});

	it("closing a view drops its pending entries", () => {
		const manager = new McpAuthManager();
		const client = makeFakeClient();
		const untrack = manager.trackClient("view-1", client);

		client.emit(oauthEvent("sheets"));
		expect(manager.getPending()).toHaveLength(1);

		untrack();
		expect(manager.getPending()).toEqual([]);
	});

	it("notifies change listeners on state transitions", () => {
		const manager = new McpAuthManager();
		const client = makeFakeClient();
		manager.trackClient("view-1", client);
		const onChange = vi.fn();
		manager.onChange(onChange);

		client.emit(oauthEvent("sheets"));
		client.emit(initializedEvent("sheets"));
		expect(onChange).toHaveBeenCalledTimes(2);
	});
});

describe("pure core", () => {
	it("reduceMcpAuth is total: initialized-before-request returns false", () => {
		const state = createMcpAuthState();
		expect(reduceMcpAuth(state, "v", initializedEvent("x"), 0)).toBe(false);
	});

	it("oauthUrlHost extracts the hostname; empty on garbage", () => {
		expect(oauthUrlHost("https://accounts.google.com/x?y=1")).toBe(
			"accounts.google.com",
		);
		expect(oauthUrlHost("not a url")).toBe("");
	});
});
