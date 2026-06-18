/**
 * Tests for `useChatActions.handleReload` — the header ↻ Reload control wiring.
 * Spec: `Agent Console Reload Control` (T3 hard reload, T4 cancel-while-sending,
 * plus soft-reload resumed vs degraded routing).
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatActions } from "../useChatActions";
import type { ChatMessage } from "../../types/chat";

// Capture Notice messages while preserving the rest of the obsidian stub
// (Platform, setIcon, etc.) so unrelated imports keep working.
const { noticeMessages } = vi.hoisted(() => ({
	noticeMessages: [] as string[],
}));
vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		Notice: class {
			constructor(message: string) {
				noticeMessages.push(message);
			}
		},
	};
});

type Params = Parameters<typeof useChatActions>;

/** Recursive proxy: any unspecified property access returns a callable mock. */
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

function msg(): ChatMessage {
	return {
		id: "m1",
		role: "user",
		content: [{ type: "text", text: "hi" }],
		timestamp: new Date(),
	};
}

interface AgentOverrides {
	isSending?: boolean;
	cancelOperation?: ReturnType<typeof vi.fn>;
	clearMessages?: ReturnType<typeof vi.fn>;
	forceRestartAgent?: ReturnType<typeof vi.fn>;
	reloadSession?: ReturnType<typeof vi.fn>;
}

function setup(agentOverrides: AgentOverrides, messages: ChatMessage[]) {
	const invalidateCache = vi.fn();
	const plugin = deepMock() as Params[0];
	const agent = deepMock({
		isSending: false,
		cancelOperation: vi.fn().mockResolvedValue(undefined),
		clearMessages: vi.fn(),
		forceRestartAgent: vi.fn().mockResolvedValue(undefined),
		reloadSession: vi.fn().mockResolvedValue({ resumed: true }),
		...agentOverrides,
	}) as Params[1];
	const sessionHistory = deepMock({ invalidateCache }) as Params[2];
	const suggestions = deepMock() as Params[3];
	const session = {
		sessionId: "s1",
		agentId: "test-agent",
	} as unknown as Params[4];
	const settings = deepMock() as Params[6];
	const contextNotes = { notes: [], add: vi.fn() } as unknown as Params[8];

	const { result } = renderHook(() =>
		useChatActions(
			plugin,
			agent,
			sessionHistory,
			suggestions,
			session,
			messages,
			settings,
			"",
			contextNotes,
			null,
			null,
			false,
		),
	);
	return { result, agent, invalidateCache };
}

describe("useChatActions handleReload", () => {
	it("T3: hard reload clears messages, restarts the agent, and invalidates history cache", async () => {
		const clearMessages = vi.fn();
		const forceRestartAgent = vi.fn().mockResolvedValue(undefined);
		const reloadSession = vi.fn();
		const { result, invalidateCache } = setup(
			{ clearMessages, forceRestartAgent, reloadSession },
			[],
		);

		await result.current.handleReload(true);

		expect(clearMessages).toHaveBeenCalledTimes(1);
		expect(forceRestartAgent).toHaveBeenCalledTimes(1);
		expect(invalidateCache).toHaveBeenCalledTimes(1);
		// Hard reload must NOT go through the soft resume path.
		expect(reloadSession).not.toHaveBeenCalled();
	});

	it("soft reload resumes the same session and never clears the transcript", async () => {
		const clearMessages = vi.fn();
		const forceRestartAgent = vi.fn();
		const reloadSession = vi.fn().mockResolvedValue({ resumed: true });
		const { result } = setup(
			{ clearMessages, forceRestartAgent, reloadSession },
			[msg()],
		);

		await result.current.handleReload(false);

		expect(reloadSession).toHaveBeenCalledTimes(1);
		expect(clearMessages).not.toHaveBeenCalled();
		expect(forceRestartAgent).not.toHaveBeenCalled();
	});

	it("soft reload that degrades to fresh session invalidates history cache, keeps transcript", async () => {
		const clearMessages = vi.fn();
		const reloadSession = vi.fn().mockResolvedValue({ resumed: false });
		const { result, invalidateCache } = setup(
			{ clearMessages, reloadSession },
			[msg()],
		);

		await result.current.handleReload(false);

		expect(reloadSession).toHaveBeenCalledTimes(1);
		expect(invalidateCache).toHaveBeenCalledTimes(1);
		expect(clearMessages).not.toHaveBeenCalled();
	});

	it("T4: reload cancels an in-flight generation first", async () => {
		const cancelOperation = vi.fn().mockResolvedValue(undefined);
		const reloadSession = vi.fn().mockResolvedValue({ resumed: true });
		const { result } = setup(
			{ isSending: true, cancelOperation, reloadSession },
			[msg()],
		);

		await result.current.handleReload(false);

		expect(cancelOperation).toHaveBeenCalledTimes(1);
		expect(reloadSession).toHaveBeenCalledTimes(1);
	});
});

describe("useChatActions handleReload — reload feedback (b)", () => {
	it("soft reload emits an immediate 'Reloading session…' notice before the completion notice", async () => {
		noticeMessages.length = 0;
		const { result } = setup(
			{ reloadSession: vi.fn().mockResolvedValue({ resumed: true }) },
			[msg()],
		);

		await result.current.handleReload(false);

		const leading = noticeMessages.indexOf(
			"[Agent Console] Reloading session…",
		);
		const done = noticeMessages.indexOf("[Agent Console] Session reloaded");
		expect(leading).toBe(0);
		expect(done).toBeGreaterThan(leading);
	});

	it("sets isReloading true while the resume is in flight and false after it settles", async () => {
		let resolveReload!: (v: { resumed: boolean }) => void;
		const reloadSession = vi.fn(
			() =>
				new Promise<{ resumed: boolean }>((res) => {
					resolveReload = res;
				}),
		);
		const { result } = setup({ reloadSession }, [msg()]);

		expect(result.current.isReloading).toBe(false);

		let pending: Promise<void>;
		act(() => {
			pending = result.current.handleReload(false);
		});
		// Spinner is on while the resume promise is pending.
		expect(result.current.isReloading).toBe(true);

		await act(async () => {
			resolveReload({ resumed: true });
			await pending;
		});
		expect(result.current.isReloading).toBe(false);
	});
});
