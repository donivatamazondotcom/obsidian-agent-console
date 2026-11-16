/**
 * Working face: the happy exit depends on `isSending` going false and the new
 * `lastTurnEnd` arriving in the SAME committed render (useAgentMessages
 * writes both in one synchronous block). If a refactor ever splits them, the
 * indicator would see "stopped sending, no new turn end" and close instead of
 * smiling. This pins it at the real send path, with only the ACP port faked.
 *
 * Spec: [[Agent Console Working Face]] § Test Cases 5.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useAgentMessages } from "../useAgentMessages";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";
import type { IVaultAccess } from "../../services/vault-service";
import type { IMentionService } from "../../utils/mention-parser";
import type { ChatSession } from "../../types/session";
import type { TurnEnd } from "../../types/session";

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
	const renders: Array<{ isSending: boolean; lastTurnEnd: TurnEnd | null }> = [];
	const hook = renderHook(() => {
		const m = useAgentMessages(agentClient, settingsAccess, vaultAccess, session, () => {});
		renders.push({ isSending: m.isSending, lastTurnEnd: m.lastTurnEnd });
		return m;
	});
	return { ...hook, renders };
}

/**
 * Send with the prompt held open, so a render with `isSending: true` commits
 * before the turn ends; then settle the prompt.
 */
async function sendHeld(
	result: ReturnType<typeof setup>["result"],
	settle: (outcome: "resolve" | "reject") => void,
	outcome: "resolve" | "reject",
) {
	let done: Promise<unknown> = Promise.resolve();
	await act(async () => {
		done = result.current.sendMessage("hi", {
			vaultBasePath: "/vault",
			contextNotes: [],
			isFirstMessage: false,
		});
		await Promise.resolve();
	});
	// Settle OUTSIDE act: act() holds every update until its scope ends, which
	// would merge renders that production commits separately and hide a split.
	// With the act environment off, React commits on its own schedule, as it
	// does in Obsidian.
	const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prev = g.IS_REACT_ACT_ENVIRONMENT;
	g.IS_REACT_ACT_ENVIRONMENT = false;
	try {
		settle(outcome);
		await done;
		await new Promise((r) => window.setTimeout(r, 50));
	} finally {
		g.IS_REACT_ACT_ENVIRONMENT = prev;
	}
}

function heldPrompt(value: unknown, error: unknown) {
	let res!: (v: unknown) => void;
	let rej!: (e: unknown) => void;
	const sendPrompt = vi.fn<AcpClient["sendPrompt"]>(
		() => new Promise((a, b) => { res = a as (v: unknown) => void; rej = b; }) as ReturnType<AcpClient["sendPrompt"]>,
	);
	const settle = (o: "resolve" | "reject") => (o === "resolve" ? res(value) : rej(error));
	return { sendPrompt, settle };
}

/** The first render after sending started in which sending is false. */
function firstStoppedRender(renders: ReturnType<typeof setup>["renders"]) {
	const started = renders.findIndex((r) => r.isSending);
	expect(started).toBeGreaterThanOrEqual(0);
	const stopped = renders.findIndex((r, i) => i > started && !r.isSending);
	expect(stopped).toBeGreaterThan(started);
	return { before: renders[started], at: renders[stopped] };
}

describe("turn end and isSending land in one render", () => {
	it("a successful turn: the render that stops sending already has the new endTurn", async () => {
		const { sendPrompt, settle } = heldPrompt({ stopKind: "endTurn" }, null);
		const { result, renders } = setup(sendPrompt);
		await sendHeld(result, settle, "resolve");
		const { before, at } = firstStoppedRender(renders);
		expect(at.lastTurnEnd).not.toBe(before.lastTurnEnd);
		expect(at.lastTurnEnd?.outcome).toBe("endTurn");
	});

	it("a failed send: the render that stops sending already has the failed turn end", async () => {
		const { sendPrompt, settle } = heldPrompt(null, new Error("boom"));
		const { result, renders } = setup(sendPrompt);
		await sendHeld(result, settle, "reject");
		const { before, at } = firstStoppedRender(renders);
		expect(at.lastTurnEnd).not.toBe(before.lastTurnEnd);
		expect(at.lastTurnEnd?.outcome).toBe("failed");
	});
});
