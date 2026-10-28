/**
 * Kiro CLI V3 S4: McpAuthManager on V3 status snapshots (spec T7, T8).
 *
 * - A server reported `failed` with `failedAuthorization` becomes a pending
 *   sign-in with no URL yet; `connected` (or leaving the snapshot) clears it.
 * - Sign in calls the client's `resetMcpServer` (decision 2026-10-27: called
 *   although not advertised). The server then sends `_kiro/openExternalUrl`;
 *   a URL arriving soon after the user's click opens straight away, an
 *   unsolicited one waits in the notice for a click.
 * - If resetServer fails, the entry switches to a plain notice.
 * - Other failures are listed per view, once per distinct failure set.
 *
 * Spec: [[Kiro CLI V3 Support]] § T7, T8.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../../__test_stubs__/obsidian"));

import { McpAuthManager } from "../mcp-auth-manager";
import type { McpAuthEvent, KiroMcpServerStatus } from "../../types/mcp-auth";
import { Notice } from "../../__test_stubs__/obsidian";

const URL_1 = "https://auth.example.com/authorize?state=one";

function makeV3Client(reset: (serverName: string) => Promise<void> = async () => {}) {
	const listeners = new Set<(e: McpAuthEvent) => void>();
	const resetMcpServer = vi.fn(reset);
	return {
		onMcpAuthEvent(cb: (e: McpAuthEvent) => void) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		resetMcpServer,
		emit(e: McpAuthEvent) {
			for (const cb of listeners) cb(e);
		},
	};
}

const srv = (
	name: string,
	status: KiroMcpServerStatus["status"],
	failedAuthorization = false,
	errorMessage?: string,
): KiroMcpServerStatus => ({ name, status, failedAuthorization, ...(errorMessage !== undefined && { errorMessage }) });

const snap = (...servers: KiroMcpServerStatus[]): McpAuthEvent => ({ kind: "status_snapshot", sessionId: "s1", servers });

/** Text content of the newest visible Notice, buttons included. */
function liveNoticeText(): string {
	const live = Notice.instances.filter((n) => !n.hidden);
	if (live.length === 0) return "";
	const msg = live[live.length - 1].message;
	return typeof msg === "string" ? msg : (msg.textContent ?? "");
}

describe("McpAuthManager on V3 snapshots (T7)", () => {
	beforeEach(() => {
		Notice.instances = [];
	});

	it("an auth failure becomes a pending sign-in with no URL; connected clears it", () => {
		const manager = new McpAuthManager();
		const client = makeV3Client();
		manager.trackClient("view-1", client);

		client.emit(snap(srv("sheets", "failed", true, "Unauthorized"), srv("drive", "connected")));
		expect(manager.getPending()).toMatchObject([{ serverName: "sheets", host: "" }]);
		expect(manager.getPending()[0].oauthUrl).toBeUndefined();
		expect(liveNoticeText()).toContain("sheets");
		expect(liveNoticeText()).toContain("Sign in");
		expect(liveNoticeText()).not.toContain("Copy link");

		client.emit(snap(srv("sheets", "connected"), srv("drive", "connected")));
		expect(manager.getPending()).toEqual([]);
		expect(Notice.instances.every((n) => n.hidden)).toBe(true);
	});

	it("keeps the pending entry while the server is reconnecting after Sign in", () => {
		const manager = new McpAuthManager();
		const client = makeV3Client();
		manager.trackClient("view-1", client);
		client.emit(snap(srv("sheets", "failed", true)));
		client.emit(snap(srv("sheets", "connecting")));
		expect(manager.getPending().map((p) => p.serverName)).toEqual(["sheets"]);
	});

	it("a server that leaves the snapshot, or fails for another reason, is no longer a pending sign-in", () => {
		const manager = new McpAuthManager();
		const client = makeV3Client();
		manager.trackClient("view-1", client);
		client.emit(snap(srv("sheets", "failed", true), srv("gmail", "failed", true)));
		client.emit(snap(srv("gmail", "failed", false, "spawn ENOENT")));
		expect(manager.getPending()).toEqual([]);
	});

	it("an identical snapshot does not re-render the notice", () => {
		const manager = new McpAuthManager();
		const client = makeV3Client();
		manager.trackClient("view-1", client);
		client.emit(snap(srv("sheets", "failed", true)));
		const count = Notice.instances.length;
		client.emit(snap(srv("sheets", "failed", true)));
		expect(Notice.instances.length).toBe(count);
	});

	it("lists other failures per view and clears them when the server connects", () => {
		const manager = new McpAuthManager();
		const client = makeV3Client();
		manager.trackClient("view-1", client);
		client.emit(snap(srv("slack", "failed", false, "spawn slack-mcp ENOENT"), srv("sheets", "failed", true)));
		expect(manager.getFailures("view-1")).toEqual([{ serverName: "slack", message: "spawn slack-mcp ENOENT" }]);
		expect(manager.getFailures("view-2")).toEqual([]);
		client.emit(snap(srv("slack", "connected"), srv("sheets", "failed", true)));
		expect(manager.getFailures("view-1")).toEqual([]);
	});

	it("a dismissed failure list stays hidden until the set of failures changes", () => {
		const manager = new McpAuthManager();
		const client = makeV3Client();
		manager.trackClient("view-1", client);
		client.emit(snap(srv("slack", "failed", false, "boom")));
		manager.dismissFailures("view-1");
		expect(manager.getFailures("view-1")).toEqual([]);
		client.emit(snap(srv("slack", "failed", false, "boom")));
		expect(manager.getFailures("view-1")).toEqual([]);
		client.emit(snap(srv("slack", "failed", false, "boom"), srv("chorus", "failed", false, "bang")));
		expect(manager.getFailures("view-1").map((f) => f.serverName)).toEqual(["slack", "chorus"]);
	});

	it("closing the view drops its status, failures and pending sign-ins", () => {
		const manager = new McpAuthManager();
		const client = makeV3Client();
		const untrack = manager.trackClient("view-1", client);
		client.emit(snap(srv("slack", "failed", false, "boom"), srv("sheets", "failed", true)));
		untrack();
		expect(manager.getFailures("view-1")).toEqual([]);
		expect(manager.getPending()).toEqual([]);
	});
});

describe("McpAuthManager sign-in on V3 (T8)", () => {
	let open: ReturnType<typeof vi.spyOn>;
	beforeEach(() => {
		Notice.instances = [];
		open = vi.spyOn(window, "open").mockImplementation(() => null);
	});
	afterEach(() => {
		open.mockRestore();
		vi.useRealTimers();
	});

	it("Sign in calls resetMcpServer; the URL that follows opens straight away", async () => {
		const manager = new McpAuthManager();
		const client = makeV3Client();
		manager.trackClient("view-1", client);
		client.emit(snap(srv("sheets", "failed", true)));

		manager.openSignIn(manager.getPending()[0]);
		expect(client.resetMcpServer).toHaveBeenCalledWith("sheets");
		expect(open).not.toHaveBeenCalled();

		client.emit({ kind: "open_external_url", url: URL_1 });
		expect(open).toHaveBeenCalledWith(URL_1);
	});

	it("an unsolicited sign-in URL is never opened automatically; it waits for a click", () => {
		const manager = new McpAuthManager();
		const client = makeV3Client();
		manager.trackClient("view-1", client);
		client.emit(snap(srv("sheets", "failed", true)));

		client.emit({ kind: "open_external_url", url: URL_1, serverName: "sheets" });
		expect(open).not.toHaveBeenCalled();
		const entry = manager.getPending()[0];
		expect(entry).toMatchObject({ serverName: "sheets", oauthUrl: URL_1, host: "auth.example.com" });
		expect(liveNoticeText()).toContain("Copy link");

		// Sign in asks for a fresh page (the stored one may belong to an
		// attempt that already ended); the page that follows opens.
		manager.openSignIn(entry);
		expect(client.resetMcpServer).toHaveBeenCalledWith("sheets");
		client.emit({ kind: "open_external_url", url: URL_1 + "&fresh" });
		expect(open).toHaveBeenCalledWith(URL_1 + "&fresh");
	});

	it("a URL arriving long after the click is treated as unsolicited", () => {
		vi.useFakeTimers();
		const manager = new McpAuthManager();
		const client = makeV3Client();
		manager.trackClient("view-1", client);
		client.emit(snap(srv("sheets", "failed", true)));
		manager.openSignIn(manager.getPending()[0]);
		vi.advanceTimersByTime(10 * 60 * 1000);
		client.emit({ kind: "open_external_url", url: URL_1 });
		expect(open).not.toHaveBeenCalled();
	});

	it("an unsolicited URL with no matching server still gets a pending entry", () => {
		const manager = new McpAuthManager();
		const client = makeV3Client();
		manager.trackClient("view-1", client);
		client.emit({ kind: "open_external_url", url: URL_1 });
		expect(open).not.toHaveBeenCalled();
		expect(manager.getPending()).toHaveLength(1);
		expect(manager.getPending()[0].oauthUrl).toBe(URL_1);
	});

	it("a reset that fails after the sign-in page opened (abandoned sign-in) keeps Sign in available", async () => {
		let rejectReset: (e: Error) => void = () => {};
		const manager = new McpAuthManager();
		const client = makeV3Client(
			() =>
				new Promise<void>((_resolve, reject) => {
					rejectReset = reject;
				}),
		);
		manager.trackClient("view-1", client);
		client.emit(snap(srv("sheets", "failed", true)));
		manager.openSignIn(manager.getPending()[0]);
		client.emit({ kind: "open_external_url", url: URL_1 });
		expect(open).toHaveBeenCalledWith(URL_1);

		// The server answers resetServer only when the sign-in ends; here it failed.
		rejectReset(new Error("MCP server failed to connect"));
		await new Promise((r) => setTimeout(r, 0));
		expect(manager.getPending()[0].signInUnavailable).toBeUndefined();
		expect(liveNoticeText()).toContain("Sign in");
	});

	it("if resetServer fails, the notice switches to plain text with no Sign in button", async () => {
		const manager = new McpAuthManager();
		const client = makeV3Client(async () => {
			throw new Error("Internal error");
		});
		manager.trackClient("view-1", client);
		client.emit(snap(srv("sheets", "failed", true)));

		manager.openSignIn(manager.getPending()[0]);
		await vi.waitFor(() => expect(manager.getPending()[0].signInUnavailable).toBe(true));
		expect(liveNoticeText()).toContain("sheets");
		expect(liveNoticeText()).not.toContain("Sign in");
		expect(liveNoticeText()).toContain("Kiro CLI");
	});
});

// Found in the S4 human smoke (2026-10-27).
describe("S4 smoke findings", () => {
	let open: ReturnType<typeof vi.spyOn>;
	beforeEach(() => {
		Notice.instances = [];
		open = vi.spyOn(window, "open").mockImplementation(() => null);
	});
	afterEach(() => open.mockRestore());

	it("check 1: snapshots that only change other servers don't re-create the sign-in notice", () => {
		const manager = new McpAuthManager();
		const client = makeV3Client();
		manager.trackClient("view-1", client);
		client.emit(snap(srv("sheets", "failed", true), srv("drive", "connecting")));
		const count = Notice.instances.length;
		client.emit(snap(srv("sheets", "failed", true), srv("drive", "connected")));
		client.emit(snap(srv("sheets", "failed", true), srv("drive", "connected"), srv("slack", "failed", false, "x")));
		// Obsidian fades a hidden Notice out, so each re-create stacks a prompt.
		expect(Notice.instances.length).toBe(count);
	});

	it("check 3: a second Sign in click opens its page even if the first reset fails afterwards", async () => {
		const rejects: Array<(e: Error) => void> = [];
		const manager = new McpAuthManager();
		const client = makeV3Client(
			() => new Promise<void>((_res, rej) => { rejects.push(rej); }),
		);
		manager.trackClient("view-1", client);
		client.emit(snap(srv("sheets", "failed", true)));
		manager.openSignIn(manager.getPending()[0]);
		client.emit({ kind: "open_external_url", url: URL_1 });
		expect(open).toHaveBeenCalledTimes(1);

		// User closed the page and clicks Sign in again; the server supersedes
		// the first attempt, which then rejects.
		client.emit(snap(srv("sheets", "connecting")));
		manager.openSignIn(manager.getPending()[0]);
		rejects[0](new Error("superseded"));
		await new Promise((r) => setTimeout(r, 0));

		client.emit({ kind: "open_external_url", url: URL_1 + "&2" });
		expect(open).toHaveBeenCalledTimes(2);
	});

	it("an unnamed sign-in URL is matched to the one server waiting in the status, never labeled 'MCP server'", () => {
		const manager = new McpAuthManager();
		const client = makeV3Client();
		manager.trackClient("view-1", client);
		client.emit(snap(srv("sheets", "failed", true), srv("drive", "connecting")));
		// The snapshot-born entry is gone while the server reconnects on its
		// own (e.g. after the user signed in elsewhere and it failed again).
		client.emit(snap(srv("sheets", "disabled"), srv("drive", "connected")));
		client.emit(snap(srv("sheets", "connecting"), srv("drive", "connected"), srv("chorus", "connecting")));
		client.emit({ kind: "open_external_url", url: URL_1 });
		expect(manager.getPending().map((p) => p.serverName)).toEqual(["sheets"]);
	});
});
