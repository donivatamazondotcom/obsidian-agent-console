/**
 * #277 — Working directory setting not honoured.
 *
 * A per-agent working directory (resolved into ChatPanel's `agentCwd` and
 * handed to the ACP `session/new` call) was NOT reaching the host-context
 * briefing. `useChatActions` fed `vaultPath` — which resolves only the GLOBAL
 * default and ignores the per-agent setting — into `sendMessage`'s
 * `workingDirectory`. So the `<obsidian_system_instruction>` block told the
 * agent "Your working directory is <the vault>" and, because that path equals
 * the vault root, fired the vault-collaboration block ("This working directory
 * is the user's Obsidian vault..."). The agent then scoured the vault instead
 * of the configured external directory, even though its real process cwd was
 * correct.
 *
 * Live-wiring reproduction (per skill-rules "test the LIVE wiring, not just the
 * pure function"): enter at the useChatActions send seam and assert the
 * options passed to agent.sendMessage carry the per-agent cwd, with the true
 * vault root preserved so the vault-collaboration gate stays honest.
 *
 * RED against the pre-fix body (`workingDirectory: vaultPath`).
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatActions } from "../useChatActions";
import type { ChatMessage } from "../../types/chat";

type Params = Parameters<typeof useChatActions>;

/** Recursive proxy so the hook's many dep-array reads don't throw; specific
 *  fields come from `overrides`. Mirrors useChatActions.test.ts. */
function deepMock(overrides: Record<string, unknown> = {}): unknown {
	const cache: Record<string, unknown> = { ...overrides };
	return new Proxy(function () {}, {
		get(_t, p: string | symbol) {
			if (typeof p === "symbol") return undefined;
			if (!(p in cache)) cache[p] = deepMock();
			return cache[p];
		},
		apply: () => undefined,
	});
}

describe("useChatActions handleSendMessage — per-agent cwd reaches the host-context briefing (#277)", () => {
	const VAULT = "/home/zanod/Obsidian/vault";
	const AGENT_CWD =
		"/mnt/c_drive/Users/zanod/My Documents/Obsidian/PDF_index_files";

	function sendOptions(): {
		workingDirectory?: string;
		vaultRootPath?: string;
		vaultBasePath?: string;
	} {
		const sendMessage = vi.fn(() => new Promise<void>(() => {}));
		const plugin = deepMock({
			app: deepMock({
				metadataCache: deepMock({ getFirstLinkpathDest: () => null }),
			}),
		}) as Params[0];
		const agent = deepMock({ clearError: vi.fn(), sendMessage }) as Params[1];
		const sessionHistory = deepMock({
			saveSessionLocally: vi.fn(),
		}) as Params[2];
		const suggestions = deepMock() as Params[3];
		const session = { sessionId: "s1" } as unknown as Params[4];
		const settings = deepMock() as Params[6];
		const contextNotes = { notes: [], add: vi.fn() } as unknown as Params[8];

		const { result } = renderHook(() =>
			useChatActions(
				plugin,
				agent,
				sessionHistory,
				suggestions,
				session,
				[], // first message
				settings,
				VAULT, // vaultPath (global-default resolution == vault root here)
				contextNotes,
				null,
				null,
				false,
				{ current: null } as Params[12],
				VAULT, // vaultRoot (true vault base path)
				AGENT_CWD, // agentCwd (the per-agent session cwd)
			),
		);

		void act(() => {
			void result.current.handleSendMessage("what's in my PDF index?");
		});

		expect(sendMessage).toHaveBeenCalledTimes(1);
		return (sendMessage.mock.calls[0] as unknown[])[1] as {
			workingDirectory?: string;
			vaultRootPath?: string;
			vaultBasePath?: string;
		};
	}

	it("sends workingDirectory = the per-agent cwd, not the vault path", () => {
		expect(sendOptions().workingDirectory).toBe(AGENT_CWD);
	});

	it("keeps vaultRootPath = the true vault root (vault-collaboration gate stays honest)", () => {
		expect(sendOptions().vaultRootPath).toBe(VAULT);
	});
});
