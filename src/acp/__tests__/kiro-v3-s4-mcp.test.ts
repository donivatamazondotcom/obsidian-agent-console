/**
 * Kiro CLI V3 S4: MCP status snapshots, sign-in requests, and the client's
 * extension wiring (spec T7, T9).
 *
 * Wire facts, read from the 2.34.3-nightly.3 server bundle and live probes
 * (2026-10-27):
 *   - `_kiro/mcp/status` is a per-session full snapshot `{sessionId, servers}`.
 *     A server is `{name, status, failedAuthorization?, errorMessage?,
 *     authorizationUrl?, _meta}`; status is connecting | connected | failed |
 *     disabled.
 *   - `_kiro/openExternalUrl` is an agent-to-client REQUEST `{url}` that the
 *     server awaits inside its OAuth flow; an error reply fails the sign-in.
 *   - `_kiro/mcp/resetServer` works (`{success: true}`) but is not advertised.
 *
 * Spec: [[Kiro CLI V3 Support]] § T7, T9.
 */
import { describe, expect, it, vi } from "vitest";
import * as acp from "@agentclientprotocol/sdk";

import {
	KIRO_MCP_STATUS_METHOD,
	KIRO_OPEN_EXTERNAL_URL_METHOD,
	parseKiroMcpStatus,
	parseOpenExternalUrl,
} from "../mcp-auth-parsers";
import { reduceMcpStatusSnapshot, buildClientCapabilities } from "../kiro-v3";
import { AcpHandler } from "../acp-handler";
import { AcpClient, registerClientHandlers, type AgentConfig } from "../acp-client";
import type { McpAuthEvent } from "../../types/mcp-auth";
import type { PermissionManager } from "../permission-handler";
import type { TerminalManager } from "../terminal-handler";
import type { Logger } from "../../utils/logger";
import type AgentClientPlugin from "../../plugin";

const SECRET_URL = "https://auth.example.com/authorize?state=s3cr3t&code_challenge=abc";

function makeLogger() {
	const calls: unknown[][] = [];
	const rec = (...args: unknown[]) => {
		calls.push(args);
	};
	const logger = { log: rec, warn: rec, error: rec, debug: rec, info: rec } as unknown as Logger;
	return { logger, calls };
}

function makeHandler(currentSessionId: string | null = null) {
	const { logger, calls } = makeLogger();
	const handler = new AcpHandler(
		{} as PermissionManager,
		{} as TerminalManager,
		() => "/vault",
		() => currentSessionId,
		logger,
	);
	const events: McpAuthEvent[] = [];
	handler.onMcpAuthEvent((e) => events.push(e));
	return { handler, events, calls };
}

const wireServer = (name: string, status: string, extra: Record<string, unknown> = {}) => ({
	name,
	status,
	_meta: { kiro: { resource: { krn: `krn:mcp:${name}`, source: { path: "/Users/x/.kiro/settings/mcp.json" } } } },
	...extra,
});

// ---------------------------------------------------------------------------
// T7: parser
// ---------------------------------------------------------------------------

describe("parseKiroMcpStatus (T7)", () => {
	it("keeps name, status, failedAuthorization and errorMessage; drops URLs and _meta", () => {
		const parsed = parseKiroMcpStatus({
			sessionId: "s1",
			servers: [
				wireServer("drive", "connected", { tools: [{ name: "t" }] }),
				wireServer("sheets", "failed", {
					failedAuthorization: true,
					authorizationUrl: SECRET_URL,
					errorMessage: "Unauthorized",
				}),
				wireServer("slack", "failed", { failedAuthorization: false, errorMessage: "spawn slack-mcp ENOENT" }),
			],
		});
		expect(parsed).toEqual({
			sessionId: "s1",
			servers: [
				{ name: "drive", status: "connected", failedAuthorization: false },
				{ name: "sheets", status: "failed", failedAuthorization: true, errorMessage: "Unauthorized" },
				{ name: "slack", status: "failed", failedAuthorization: false, errorMessage: "spawn slack-mcp ENOENT" },
			],
		});
		expect(JSON.stringify(parsed)).not.toContain("auth.example.com");
		expect(JSON.stringify(parsed)).not.toContain("mcp.json");
	});

	it("maps an unknown status to 'unknown' instead of guessing", () => {
		const parsed = parseKiroMcpStatus({ sessionId: "s1", servers: [wireServer("x", "warming")] });
		expect(parsed.servers[0].status).toBe("unknown");
	});

	it("drops an entry without a usable name, keeps the rest", () => {
		const parsed = parseKiroMcpStatus({
			sessionId: "s1",
			servers: [{ status: "connected" }, { name: "", status: "failed" }, wireServer("ok", "connected")],
		});
		expect(parsed.servers.map((s) => s.name)).toEqual(["ok"]);
	});

	it.each([
		["null params", null],
		["missing servers", { sessionId: "s1" }],
		["servers not an array", { sessionId: "s1", servers: {} }],
		["missing sessionId", { servers: [] }],
	])("throws on a malformed snapshot (%s)", (_label, params) => {
		expect(() => parseKiroMcpStatus(params)).toThrow(/Malformed/);
	});
});

describe("parseOpenExternalUrl", () => {
	it("accepts an https URL and an optional server name", () => {
		expect(parseOpenExternalUrl({ url: SECRET_URL })).toEqual({ url: SECRET_URL });
		expect(parseOpenExternalUrl({ url: SECRET_URL, serverName: "sheets" })).toEqual({
			url: SECRET_URL,
			serverName: "sheets",
		});
	});

	it.each([
		["missing url", {}],
		["non-http scheme", { url: "file:///etc/passwd" }],
		["javascript scheme", { url: "javascript:alert(1)" }],
		["not a URL", { url: "nope" }],
	])("rejects %s", (_label, params) => {
		expect(() => parseOpenExternalUrl(params)).toThrow(/Malformed/);
	});
});

// ---------------------------------------------------------------------------
// T7: reducer
// ---------------------------------------------------------------------------

describe("reduceMcpStatusSnapshot (T7)", () => {
	const s = (name: string, status: "connected" | "connecting" | "failed", failedAuthorization = false, errorMessage?: string) => ({
		name,
		status,
		failedAuthorization,
		...(errorMessage !== undefined && { errorMessage }),
	});

	it("replaces state by server name; a server missing from the snapshot is gone", () => {
		const first = reduceMcpStatusSnapshot(new Map(), [s("a", "connecting"), s("b", "connecting")]);
		expect(first.changed).toBe(true);
		const second = reduceMcpStatusSnapshot(first.next, [s("a", "connected")]);
		expect([...second.next.keys()]).toEqual(["a"]);
		expect(second.next.get("a")?.status).toBe("connected");
		expect(second.changed).toBe(true);
	});

	it("never holds duplicates: a repeated name keeps the last entry", () => {
		const { next } = reduceMcpStatusSnapshot(new Map(), [s("a", "connecting"), s("a", "failed", false, "boom")]);
		expect(next.size).toBe(1);
		expect(next.get("a")?.status).toBe("failed");
	});

	it("an unchanged snapshot reports no change (no re-display of the same failure)", () => {
		const snap = [s("a", "failed", false, "boom"), s("b", "connected")];
		const first = reduceMcpStatusSnapshot(new Map(), snap);
		const again = reduceMcpStatusSnapshot(first.next, snap.map((x) => ({ ...x })));
		expect(again.changed).toBe(false);
	});

	it("a changed error message is a change", () => {
		const first = reduceMcpStatusSnapshot(new Map(), [s("a", "failed", false, "boom")]);
		expect(reduceMcpStatusSnapshot(first.next, [s("a", "failed", false, "bang")]).changed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// T7: handler: routing and no secrets in logs
// ---------------------------------------------------------------------------

describe("AcpHandler: V3 MCP status and sign-in requests (T7)", () => {
	const snapshot = {
		sessionId: "s1",
		servers: [
			{ name: "sheets", status: "failed" as const, failedAuthorization: true, errorMessage: `Unauthorized at ${SECRET_URL}` },
			{ name: "drive", status: "connected" as const, failedAuthorization: false },
		],
	};

	it("emits a status snapshot for the current session", () => {
		const { handler, events } = makeHandler("s1");
		handler.mcpStatus(snapshot);
		expect(events).toEqual([{ kind: "status_snapshot", ...snapshot }]);
	});

	it("emits before the session is committed (session/new not resolved yet)", () => {
		const { handler, events } = makeHandler(null);
		handler.mcpStatus(snapshot);
		expect(events).toHaveLength(1);
	});

	it("drops a snapshot for another session or a side session", () => {
		const { handler, events } = makeHandler("s2");
		handler.mcpStatus(snapshot);
		handler.registerSideSession("side-1", () => {});
		handler.mcpStatus({ ...snapshot, sessionId: "side-1" });
		expect(events).toEqual([]);
	});

	it("answers openExternalUrl at once with {success: true} and hands the URL on", () => {
		const { handler, events } = makeHandler("s1");
		expect(handler.openExternalUrl({ url: SECRET_URL })).toEqual({ success: true });
		expect(events).toEqual([{ kind: "open_external_url", url: SECRET_URL }]);
	});

	it("never logs a URL, an error message, or a token", () => {
		const { handler, calls } = makeHandler("s1");
		handler.mcpStatus(snapshot);
		handler.openExternalUrl({ url: SECRET_URL, serverName: "sheets" });
		const logged = JSON.stringify(calls);
		expect(logged).not.toContain("auth.example.com");
		expect(logged).not.toContain("s3cr3t");
		expect(logged).not.toContain("Unauthorized at");
	});
});

// ---------------------------------------------------------------------------
// T9 + registration: the real client wiring over an in-process connection
// ---------------------------------------------------------------------------

describe("registerClientHandlers (T9)", () => {
	async function connect() {
		const { handler, events } = makeHandler("s1");
		let agentSide: acp.AgentContext | undefined;
		const agentApp = acp.agent().onConnect((c) => {
			agentSide = c.client;
		});
		const conn = registerClientHandlers(acp.client({ name: "agent-console" }), handler).connect(agentApp);
		await vi.waitFor(() => expect(agentSide).toBeDefined());
		return { handler, events, agentSide: agentSide!, conn };
	}

	it("handles _kiro/openExternalUrl (registered before any initialize)", async () => {
		const { agentSide, events } = await connect();
		await expect(agentSide.request(KIRO_OPEN_EXTERNAL_URL_METHOD, { url: SECRET_URL })).resolves.toEqual({
			success: true,
		});
		expect(events).toEqual([{ kind: "open_external_url", url: SECRET_URL }]);
	});

	it("rejects an unsafe openExternalUrl with a JSON-RPC error", async () => {
		const { agentSide, events } = await connect();
		await expect(agentSide.request(KIRO_OPEN_EXTERNAL_URL_METHOD, { url: "file:///etc/passwd" })).rejects.toBeDefined();
		expect(events).toEqual([]);
	});

	it("routes _kiro/mcp/status notifications to the handler", async () => {
		const { agentSide, events } = await connect();
		await agentSide.notify(KIRO_MCP_STATUS_METHOD, {
			sessionId: "s1",
			servers: [wireServer("drive", "connected")],
		});
		await vi.waitFor(() => expect(events).toHaveLength(1));
		expect(events[0]).toMatchObject({ kind: "status_snapshot", servers: [{ name: "drive", status: "connected" }] });
	});

	it("answers an unknown agent-to-client request with Method not found (-32601)", async () => {
		const { agentSide } = await connect();
		await expect(agentSide.request("_kiro/notARealClientMethod", {})).rejects.toMatchObject({ code: -32601 });
	});
});

// ---------------------------------------------------------------------------
// Capability + resetServer
// ---------------------------------------------------------------------------

const cfg = (engine?: "v3"): AgentConfig =>
	({
		id: "kiro",
		displayName: "Kiro",
		command: "kiro-cli",
		args: ["acp"],
		workingDirectory: "/vault",
		...(engine && { kiroEngine: engine }),
	}) as AgentConfig;

describe("buildClientCapabilities: openExternalUrl", () => {
	it("v3 advertises openExternalUrl next to hooks", () => {
		expect(buildClientCapabilities(cfg("v3"))._meta?.kiro).toEqual({
			hooks: { enabled: true, v2: true },
			openExternalUrl: true,
		});
	});
	it("v2 advertises nothing Kiro-specific", () => {
		expect(buildClientCapabilities(cfg())._meta).not.toHaveProperty("kiro");
	});
});

describe("AcpClient.resetMcpServer", () => {
	function makeClient(engine?: "v3") {
		const plugin = {
			settings: { autoAllowPermissions: false, windowsWslMode: false },
			manifest: { version: "0.0.0-test" },
		} as unknown as AgentClientPlugin;
		const client = new AcpClient(plugin);
		const internals = client as unknown as { currentConfig: unknown; requireConnection: () => unknown; currentSessionId: string | null };
		internals.currentConfig = cfg(engine);
		const request = vi.fn(async () => ({ success: true }));
		vi.spyOn(internals, "requireConnection").mockReturnValue({ agent: { request } });
		return { client, request, internals };
	}

	it("V3: sends resetServer with startOAuth for the current session", async () => {
		const { client, request, internals } = makeClient("v3");
		internals.currentSessionId = "s1";
		await client.resetMcpServer("sheets");
		expect(request).toHaveBeenCalledWith("_kiro/mcp/resetServer", {
			sessionId: "s1",
			serverName: "sheets",
			startOAuth: true,
		});
	});

	it("V2: refuses without touching the wire", async () => {
		const { client, request } = makeClient();
		await expect(client.resetMcpServer("sheets")).rejects.toThrow(/V3/);
		expect(request).not.toHaveBeenCalled();
	});
});
