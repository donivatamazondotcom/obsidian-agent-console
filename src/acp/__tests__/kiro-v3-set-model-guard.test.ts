/**
 * Kiro CLI V3 S2 (spec T5): the ACP client never sends `session/set_model`
 * on a V3 connection.
 *
 * V3 answers `session/set_model` with "Internal error" (verified live on
 * kiro-cli 2.34.2-nightly.1, 2026-10-26). Today no caller reaches it on V3
 * only because V3 sends no legacy `models` field. This guard makes "never"
 * hold by construction: on a V3 config the client refuses locally and nothing
 * goes on the wire. V2 behavior is unchanged.
 *
 * Red-first (R1): before S2 the V3 case sends the request.
 */

import { describe, it, expect, vi } from "vitest";
import { AcpClient } from "../acp-client";
import type { AgentConfig } from "../acp-client";
import type AgentClientPlugin from "../../plugin";

function makeClient(config: Partial<AgentConfig> | null) {
	const plugin = {
		settings: { autoAllowPermissions: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	const client = new AcpClient(plugin);
	(client as unknown as { currentConfig: unknown }).currentConfig = config;
	const request = vi.fn().mockResolvedValue(undefined);
	vi.spyOn(
		client as unknown as { requireConnection: () => unknown },
		"requireConnection",
	).mockReturnValue({ agent: { request } });
	return { client, request };
}

const base = {
	id: "test-agent",
	displayName: "Test Agent",
	command: "kiro-cli",
	args: ["acp"],
	workingDirectory: "/cwd",
};

describe("AcpClient.setSessionModel on Kiro CLI V3", () => {
	it("V3: rejects without sending session/set_model", async () => {
		const { client, request } = makeClient({ ...base, kiroEngine: "v3" });

		await expect(client.setSessionModel("s1", "m")).rejects.toThrow(
			/config option/i,
		);
		expect(request).not.toHaveBeenCalled();
	});

	it("V2: still sends session/set_model", async () => {
		const { client, request } = makeClient({ ...base });

		await client.setSessionModel("s1", "m");

		expect(request).toHaveBeenCalledWith("session/set_model", {
			sessionId: "s1",
			modelId: "m",
		});
	});
});
