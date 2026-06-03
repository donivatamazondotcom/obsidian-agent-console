/**
 * D2 (Agent Console Amazon Agent Defaults): kiro-cli exposes agents as ACP
 * session *modes* and silently reverts session 2+ on a shared subprocess back
 * to `kiro_default` (see Kiro-CLI ACP Client Guide). Tabs within a ChatView
 * share one per-view AcpClient/subprocess (plugin.getOrCreateAcpClient), and
 * "New chat" reuses it — so this revert is live for the kiro preset.
 *
 * restoreLegacyConfig is the mechanism that neutralizes it: it re-applies the
 * user's saved mode after every session/new. These tests pin that invariant so
 * the kiro preset needs NO dedicated set_mode wiring. If the setSessionMode
 * call is ever removed (regressing to relying on kiro's broken `--agent`
 * stickiness), the first test goes red.
 */

import { describe, it, expect, vi } from "vitest";
import { restoreLegacyConfig } from "../session-state";
import type { SessionResult } from "../../types/session";
import type { AcpClient } from "../../acp/acp-client";

function kiroSession(currentModeId: string): SessionResult {
	return {
		sessionId: "sess-1",
		modes: {
			currentModeId,
			availableModes: [
				{ id: "kiro_default", name: "Kiro Default" },
				{ id: "auto-sa", name: "auto-sa" },
			],
		},
	};
}

function mockClient() {
	const setSessionMode = vi.fn(async () => {});
	const client = {
		setSessionMode,
		setSessionModel: vi.fn(async () => {}),
	} as unknown as AcpClient;
	return { client, setSessionMode };
}

describe("restoreLegacyConfig — D2 kiro mode-revert neutralization", () => {
	it("re-applies the saved mode when a new session reverted to kiro_default", async () => {
		const { client, setSessionMode } = mockClient();

		const result = await restoreLegacyConfig(
			client,
			kiroSession("kiro_default"),
			undefined,
			"auto-sa",
		);

		expect(setSessionMode).toHaveBeenCalledWith("sess-1", "auto-sa");
		expect(result.modes?.currentModeId).toBe("auto-sa");
	});

	it("no saved mode → no set_mode call; kiro_default stays (default Amazon case)", async () => {
		const { client, setSessionMode } = mockClient();

		const result = await restoreLegacyConfig(
			client,
			kiroSession("kiro_default"),
			undefined,
			undefined,
		);

		expect(setSessionMode).not.toHaveBeenCalled();
		expect(result.modes?.currentModeId).toBe("kiro_default");
	});
});
