/**
 * AcpClient.listSessions — cwd filter mapping (item g / D10).
 *
 * The agent-side half of the "This vault only" contract: the cwd the checkbox
 * supplies is forwarded to the ACP `session/list` request as
 * `{ cwd: filterCwd ?? null }`. When the box is unchecked the hook passes
 * `undefined`, which MUST become `cwd: null` (list every vault) — not omitted,
 * not the previous value. Reproduce-first lock before any affordance change.
 */
import { describe, it, expect, vi } from "vitest";
import { AcpClient } from "../acp-client";
import type AgentClientPlugin from "../../plugin";

type ConnectionSeam = {
	connection: {
		agent: { request: (method: string, params: unknown) => Promise<unknown> };
	};
};

function makeClientWithFakeConnection(): {
	client: AcpClient;
	request: ReturnType<typeof vi.fn>;
} {
	const plugin = {
		settings: { autoAllowPermissions: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	const client = new AcpClient(plugin);
	const request = vi.fn(async () => ({ sessions: [], nextCursor: null }));
	(client as unknown as ConnectionSeam).connection = { agent: { request } };
	return { client, request };
}

describe("AcpClient.listSessions — cwd filter mapping (item g)", () => {
	it("forwards a supplied cwd to session/list (narrow to this vault)", async () => {
		const { client, request } = makeClientWithFakeConnection();
		await client.listSessions("/vault");
		expect(request).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ cwd: "/vault" }),
		);
	});

	it("maps an absent cwd to cwd:null (broaden to every vault), never omitting it", async () => {
		const { client, request } = makeClientWithFakeConnection();
		await client.listSessions(undefined);
		expect(request).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ cwd: null }),
		);
	});
});
