/**
 * I324: note paths sent to the agent must start at the vault root, even when
 * the chat runs in another folder.
 *
 * Root cause: ChatPanel's `vaultPath` is the tab's working folder (or the
 * global default folder), and useChatActions passed it to sendMessage as
 * `vaultBasePath`. message-sender joins that base with each note's
 * vault-relative path, so a chat in `/work/repo` sent
 * `/work/repo/Projects/Plan.md` for a note at `/vault/Projects/Plan.md`, and
 * an agent reading a large note by reference found nothing there.
 *
 * [[I324 Note paths use the working folder instead of the vault root]].
 * Entered at the hook's public API; the payload handed to sendMessage is the
 * boundary message-sender builds every note URI from.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatActions } from "../useChatActions";

type Params = Parameters<typeof useChatActions>;

/** Recursive proxy: any property read returns a callable mock. */
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

const VAULT_ROOT = "/vault";
const WORKING_FOLDER = "/work/repo";

async function sendPayload(args: {
	vaultPath: string;
	vaultRoot: string;
	agentCwd: string;
}) {
	const sendMessage = vi.fn(() => new Promise<void>(() => {}));
	const plugin = deepMock({
		app: deepMock({
			metadataCache: deepMock({ getFirstLinkpathDest: () => null }),
		}),
	}) as Params[0];
	const agent = deepMock({ clearError: vi.fn(), sendMessage }) as Params[1];
	const sessionHistory = deepMock({ saveSessionLocally: vi.fn() }) as Params[2];
	const suggestions = deepMock() as Params[3];
	const session = { sessionId: "s1" } as unknown as Params[4];
	const settings = { activeNoteAsDefaultContext: false } as unknown as Params[6];
	const contextNotes = {
		notes: [{ path: "Projects/Plan.md", source: "manual", seen: false, hydrated: false }],
		add: vi.fn(),
	} as unknown as Params[8];

	const { result } = renderHook(() =>
		useChatActions(
			plugin, agent, sessionHistory, suggestions, session,
			[], settings, args.vaultPath, contextNotes, null, null, false,
			{ current: null } as Params[12],
			args.vaultRoot,
			args.agentCwd,
		),
	);
	await act(async () => {
		void result.current.handleSendMessage("summarize the plan");
		await Promise.resolve();
	});
	expect(sendMessage).toHaveBeenCalledTimes(1);
	return (sendMessage.mock.calls[0] as unknown[])[1] as {
		vaultBasePath: string;
		workingDirectory?: string;
		vaultRootPath?: string;
	};
}

describe("I324: note paths start at the vault root", () => {
	it("a chat in a folder outside the vault sends note paths from the vault root", async () => {
		const payload = await sendPayload({
			vaultPath: WORKING_FOLDER,
			vaultRoot: VAULT_ROOT,
			agentCwd: WORKING_FOLDER,
		});

		expect(payload.vaultBasePath).toBe(VAULT_ROOT);
		// The agent's folder is unchanged: it still runs in the working folder.
		expect(payload.workingDirectory).toBe(WORKING_FOLDER);
		expect(payload.vaultRootPath).toBe(VAULT_ROOT);
	});

	it("a chat in a subfolder of the vault sends note paths from the vault root", async () => {
		const payload = await sendPayload({
			vaultPath: `${VAULT_ROOT}/Projects`,
			vaultRoot: VAULT_ROOT,
			agentCwd: `${VAULT_ROOT}/Projects`,
		});

		expect(payload.vaultBasePath).toBe(VAULT_ROOT);
	});

	it("without a vault root, keeps the folder it was given", async () => {
		const payload = await sendPayload({
			vaultPath: WORKING_FOLDER,
			vaultRoot: "",
			agentCwd: "",
		});

		expect(payload.vaultBasePath).toBe(WORKING_FOLDER);
		expect(payload.workingDirectory).toBe(WORKING_FOLDER);
	});
});
