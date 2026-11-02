/**
 * Tab Attention States — the hook reports how each turn ended, so ChatPanel
 * can decide whether the tab gets the "finished" tick or the "stopped early"
 * mark ([[Tab Attention States]] § Stop-reason plumbing).
 *
 * Seam: the public hook API (sendMessage → lastTurnEnd) with only the ACP port
 * faked (R2, R4). Outcome: the reported turn end (R3).
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useAgentMessages } from "../useAgentMessages";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";
import type { IVaultAccess } from "../../services/vault-service";
import type { IMentionService } from "../../utils/mention-parser";
import type { ChatSession } from "../../types/session";

const vaultAccess = {
	readNote: async () => "",
	getAllFiles: () => [],
	getFileByPath: () => null,
} as unknown as IVaultAccess & IMentionService;

function setup(sendPrompt: AcpClient["sendPrompt"]) {
	const agentClient = { sendPrompt } as unknown as AcpClient;
	const settingsAccess = {
		getSnapshot: () => ({ titleStrategy: "agent-timestamp", windowsWslMode: false }),
	} as unknown as ISettingsAccess;
	const session = {
		sessionId: "s1",
		authMethods: [],
		promptCapabilities: { embeddedContext: true, image: false, audio: false },
	} as unknown as ChatSession;
	return renderHook(() =>
		useAgentMessages(agentClient, settingsAccess, vaultAccess, session, vi.fn()),
	);
}

async function send(result: { current: ReturnType<typeof useAgentMessages> }) {
	await act(async () => {
		await result.current.sendMessage("hi", {
			vaultBasePath: "/vault",
			contextNotes: [],
			isFirstMessage: false,
		});
	});
}

describe("useAgentMessages — lastTurnEnd", () => {
	it("is null before any turn", () => {
		const { result } = setup(vi.fn(async () => ({ stopKind: "endTurn" as const })));
		expect(result.current.lastTurnEnd).toBeNull();
	});

	it("reports the agent's stop kind and counts turns", async () => {
		const sendPrompt = vi
			.fn<AcpClient["sendPrompt"]>()
			.mockResolvedValueOnce({ stopKind: "endTurn" })
			.mockResolvedValueOnce({ stopKind: "maxTokens" });
		const { result } = setup(sendPrompt);
		await send(result);
		expect(result.current.lastTurnEnd).toEqual({ seq: 1, outcome: "endTurn" });
		await send(result);
		expect(result.current.lastTurnEnd).toEqual({ seq: 2, outcome: "maxTokens" });
	});

	it("reports a failed send as failed", async () => {
		const { result } = setup(
			vi.fn(async () => {
				throw new Error("boom");
			}),
		);
		await send(result);
		expect(result.current.lastTurnEnd).toEqual({ seq: 1, outcome: "failed" });
	});
});
