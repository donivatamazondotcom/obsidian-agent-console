/**
 * Tests for restoring kiro-cli model selection on SDK 1.0.
 *
 * PR #131 (SDK 0.14.1 → 1.0.0) stopped reading the legacy `models` field in
 * the session response because the SDK dropped it from its types. But agents
 * such as kiro-cli still emit `models` on the wire, and the SDK passes the
 * untyped field through. These tests pin both halves of the fix:
 *  - read path: AcpTypeConverter.toSessionResult re-surfaces `models`,
 *    validated at the trust boundary (never coerces a malformed shape);
 *  - apply path: AcpClient.setSessionModel issues the raw `session/set_model`
 *    JSON-RPC method (still honored on the wire, returns {} for kiro-cli).
 *
 * See the "Restore Kiro Model Selection" spec.
 */

import { describe, it, expect, vi } from "vitest";
import { AcpTypeConverter } from "../type-converter";
import { AcpClient } from "../acp-client";
import type AgentClientPlugin from "../../plugin";

describe("AcpTypeConverter.toSessionResult — legacy model state (kiro-cli)", () => {
	// The exact shape kiro-cli v2.10.1 sends in its session/new response.
	const kiroModels = {
		currentModelId: "claude-opus-4.8",
		availableModels: [
			{ modelId: "auto", name: "auto", description: "Auto-selected" },
			{ modelId: "claude-opus-4.8", name: "claude-opus-4.8" },
			{
				modelId: "claude-opus-4.6",
				name: "claude-opus-4.6",
				description: null,
			},
		],
	};

	it("re-surfaces models from the untyped wire field kiro-cli still sends", () => {
		const r = AcpTypeConverter.toSessionResult("s1", {
			sessionId: "s1",
			models: kiroModels,
		} as never);

		expect(r.models?.currentModelId).toBe("claude-opus-4.8");
		expect(r.models?.availableModels.map((m) => m.modelId)).toEqual([
			"auto",
			"claude-opus-4.8",
			"claude-opus-4.6",
		]);
		// null description is normalized to undefined (ACP null → domain undefined)
		expect(r.models?.availableModels[2].description).toBeUndefined();
	});

	it("leaves models undefined when the agent sends none (e.g. Claude Code)", () => {
		const r = AcpTypeConverter.toSessionResult("s1", {
			sessionId: "s1",
		} as never);
		expect(r.models).toBeUndefined();
	});

	it("does not coerce a malformed models field — drops it (no availableModels array)", () => {
		const r = AcpTypeConverter.toSessionResult("s1", {
			sessionId: "s1",
			models: { currentModelId: "claude-opus-4.8" },
		} as never);
		expect(r.models).toBeUndefined();
	});

	it("does not coerce a malformed models field — drops it (missing currentModelId)", () => {
		const r = AcpTypeConverter.toSessionResult("s1", {
			sessionId: "s1",
			models: { availableModels: [{ modelId: "x", name: "x" }] },
		} as never);
		expect(r.models).toBeUndefined();
	});
});

describe("AcpClient.setSessionModel — raw session/set_model on the wire", () => {
	function makeClient(): AcpClient {
		const plugin = {
			settings: { autoAllowPermissions: false },
			manifest: { version: "0.0.0-test" },
		} as unknown as AgentClientPlugin;
		return new AcpClient(plugin);
	}

	function stubConnection(client: AcpClient, request: ReturnType<typeof vi.fn>) {
		vi.spyOn(
			client as unknown as { requireConnection: () => unknown },
			"requireConnection",
		).mockReturnValue({ agent: { request } });
	}

	it("sends session/set_model with sessionId + modelId via the untyped request overload", async () => {
		const client = makeClient();
		const request = vi.fn().mockResolvedValue(undefined);
		stubConnection(client, request);

		await client.setSessionModel("sess-1", "claude-opus-4.6");

		expect(request).toHaveBeenCalledWith("session/set_model", {
			sessionId: "sess-1",
			modelId: "claude-opus-4.6",
		});
	});

	it("propagates a Method-not-found rejection from agents that don't support it", async () => {
		const client = makeClient();
		const request = vi
			.fn()
			.mockRejectedValue(new Error("Method not found"));
		stubConnection(client, request);

		await expect(
			client.setSessionModel("sess-1", "m"),
		).rejects.toThrow("Method not found");
	});
});
