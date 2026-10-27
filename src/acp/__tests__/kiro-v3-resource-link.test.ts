/**
 * I220: Kiro CLI V3 drops `resource_link` prompt blocks.
 *
 * V3 advertises `embeddedContext: true`, so context chips (and file
 * attachments) go out as `resource_link` blocks. V3 accepts the prompt but
 * never shows those blocks to the model — no error, no log line (verified
 * live on kiro-cli V3, 2026-10-27, with an ACP probe: an embedded `resource`
 * reached the model, a `resource_link` in the same prompt did not). The ACP
 * spec says every agent MUST support resource links, so this is a V3 bug;
 * the client works around it at the ACP boundary.
 *
 * Red-first: before the fix, the V3 case puts a `resource_link` on the wire.
 */

import { describe, it, expect, vi } from "vitest";
import { AcpClient } from "../acp-client";
import type { AgentConfig } from "../acp-client";
import type AgentClientPlugin from "../../plugin";
import type { PromptContent } from "../../types/chat";

function makeClient(config: Partial<AgentConfig> | null) {
	const plugin = {
		settings: { autoAllowPermissions: false },
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
	const client = new AcpClient(plugin);
	(client as unknown as { currentConfig: unknown }).currentConfig = config;
	const request = vi.fn().mockResolvedValue({ stopReason: "end_turn" });
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

const CHIP_URI = "file:///vault/04-initiatives/I218 Forking an agent.md";

const prompt: PromptContent[] = [
	{
		type: "resource_link",
		uri: CHIP_URI,
		name: "I218 Forking an agent",
		mimeType: "text/markdown",
	},
	{ type: "text", text: "Let's work on this issue" },
];

type SentBlock = { type: string; text?: string; uri?: string };

function sentBlocks(request: ReturnType<typeof vi.fn>): SentBlock[] {
	const call = request.mock.calls.find(
		(c) => (c[1] as { prompt?: unknown })?.prompt,
	);
	expect(call).toBeDefined();
	return (call![1] as { prompt: SentBlock[] }).prompt;
}

describe("I220: V3 resource_link blocks reach the model", () => {
	it("V3: sends no resource_link; the link's URI and name go out as text", async () => {
		const { client, request } = makeClient({ ...base, kiroEngine: "v3" });
		await client.sendPrompt("s1", prompt);

		const blocks = sentBlocks(request);
		expect(blocks.some((b) => b.type === "resource_link")).toBe(false);

		const linkText = blocks.find(
			(b) => b.type === "text" && b.text?.includes(CHIP_URI),
		);
		expect(linkText?.text).toContain("I218 Forking an agent");
		// The user's message is untouched and still last.
		expect(blocks[blocks.length - 1]).toEqual({
			type: "text",
			text: "Let's work on this issue",
		});
	});

	it("V2: resource_link is sent unchanged", async () => {
		const { client, request } = makeClient({ ...base });
		await client.sendPrompt("s1", prompt);

		const blocks = sentBlocks(request);
		expect(blocks[0]).toMatchObject({ type: "resource_link", uri: CHIP_URI });
	});

	it("V3: other block types pass through unchanged", async () => {
		const { client, request } = makeClient({ ...base, kiroEngine: "v3" });
		await client.sendPrompt("s1", [
			{
				type: "resource",
				resource: { uri: CHIP_URI, mimeType: "text/markdown", text: "body" },
			},
			{ type: "image", data: "AAAA", mimeType: "image/png" },
			{ type: "text", text: "hi" },
		]);

		const types = sentBlocks(request).map((b) => b.type);
		expect(types).toEqual(["resource", "image", "text"]);
	});
});
