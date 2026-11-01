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
	closeSession?: ReturnType<typeof vi.fn>;
	reloadSession?: ReturnType<typeof vi.fn>;
}

type ReloadRun = () => Promise<
	{ ok: true; sessionId: string } | { ok: false; error: Error }
>;

function setup(
	agentOverrides: AgentOverrides,
	messages: ChatMessage[],
	opts: { wireReloadNow?: boolean } = {},
) {
	const invalidateCache = vi.fn();
	const plugin = deepMock() as Params[0];
	const agent = deepMock({
		isSending: false,
		cancelOperation: vi.fn().mockResolvedValue(undefined),
		clearMessages: vi.fn(),
		forceRestartAgent: vi.fn().mockResolvedValue(undefined),
		closeSession: vi.fn().mockResolvedValue(undefined),
		reloadSession: vi
			.fn()
			.mockResolvedValue({ resumed: true, sessionId: "s1" }),
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
	const acquireNow = vi.fn().mockResolvedValue(undefined);
	const lazyAcquireNowRef = { current: acquireNow } as Params[12];
	// I229: the lazy owner's reloadNow. The fake runs the reload and records
	// the acquisition result it was handed, like useLazySession.reloadNow.
	const reloadNowResults: Array<Awaited<ReturnType<ReloadRun>>> = [];
	const reloadNow = vi.fn(async (run: ReloadRun) => {
		reloadNowResults.push(await run());
	});
	const lazyReloadNowRef = {
		current: opts.wireReloadNow === false ? null : reloadNow,
	} as Params[15];

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
			lazyAcquireNowRef,
			"",
			"",
			lazyReloadNowRef,
		),
	);
	return {
		result,
		agent,
		invalidateCache,
		acquireNow,
		reloadNow,
		reloadNowResults,
	};
}

describe("useChatActions handleReload", () => {
	it("T3: hard reload clears messages, respawns via the single owner (closeSession + acquireNow), and invalidates history cache", async () => {
		const clearMessages = vi.fn();
		const closeSession = vi.fn().mockResolvedValue(undefined);
		const reloadSession = vi.fn();
		const { result, invalidateCache, acquireNow } = setup(
			{ clearMessages, closeSession, reloadSession },
			[],
		);

		await result.current.handleReload(true);

		expect(clearMessages).toHaveBeenCalledTimes(1);
		// Hard reload tears down the subprocess then re-acquires through the
		// single session/new owner — not a direct forceRestartAgent/createSession.
		expect(closeSession).toHaveBeenCalledTimes(1);
		expect(acquireNow).toHaveBeenCalledTimes(1);
		expect(invalidateCache).toHaveBeenCalledTimes(1);
		// Hard reload must NOT go through the soft resume path.
		expect(reloadSession).not.toHaveBeenCalled();
	});

	it("soft reload resumes the same session and never clears the transcript", async () => {
		const clearMessages = vi.fn();
		const forceRestartAgent = vi.fn();
		const reloadSession = vi
			.fn()
			.mockResolvedValue({ resumed: true, sessionId: "s1" });
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
		const reloadSession = vi
			.fn()
			.mockResolvedValue({ resumed: false, reason: "unsupported", sessionId: "s2" });
		const { result, invalidateCache } = setup(
			{ clearMessages, reloadSession },
			[msg()],
		);

		await result.current.handleReload(false);

		expect(reloadSession).toHaveBeenCalledTimes(1);
		expect(invalidateCache).toHaveBeenCalledTimes(1);
		expect(clearMessages).not.toHaveBeenCalled();
	});

	it("I230: a resume that FAILED says so and does not blame the agent's capabilities", async () => {
		const reloadSession = vi
			.fn()
			.mockResolvedValue({ resumed: false, reason: "resume-failed", sessionId: "s2" });
		const { result } = setup({ reloadSession }, [msg()]);
		noticeMessages.length = 0;

		await result.current.handleReload(false);

		expect(noticeMessages).toContain(
			"[Agent Console] Couldn't pick up the conversation, so the agent started fresh. Your messages are still here.",
		);
		expect(noticeMessages.some((m) => m.includes("can't resume"))).toBe(
			false,
		);
	});

	it("I230: an agent that can't resume keeps the can't-resume notice", async () => {
		const reloadSession = vi
			.fn()
			.mockResolvedValue({ resumed: false, reason: "unsupported", sessionId: "s2" });
		const { result } = setup({ reloadSession }, [msg()]);
		noticeMessages.length = 0;

		await result.current.handleReload(false);

		expect(noticeMessages.some((m) => m.includes("can't resume"))).toBe(
			true,
		);
	});

	it("T4: reload cancels an in-flight generation first", async () => {
		const cancelOperation = vi.fn().mockResolvedValue(undefined);
		const reloadSession = vi
			.fn()
			.mockResolvedValue({ resumed: true, sessionId: "s1" });
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
			{
				reloadSession: vi
					.fn()
					.mockResolvedValue({ resumed: true, sessionId: "s1" }),
			},
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
		let resolveReload!: (v: { resumed: boolean; sessionId: string }) => void;
		const reloadSession = vi.fn(
			() =>
				new Promise<{ resumed: boolean; sessionId: string }>((res) => {
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
			resolveReload({ resumed: true, sessionId: "s1" });
			await pending;
		});
		expect(result.current.isReloading).toBe(false);
	});
});

describe("useChatActions handleReload — single lazy owner (I229)", () => {
	it("soft reload runs through the lazy owner's reloadNow and hands it the resumed id", async () => {
		const reloadSession = vi
			.fn()
			.mockResolvedValue({ resumed: true, sessionId: "s1" });
		const { result, reloadNow, reloadNowResults } = setup(
			{ reloadSession },
			[msg()],
		);

		await result.current.handleReload(false);

		expect(reloadNow).toHaveBeenCalledTimes(1);
		expect(reloadSession).toHaveBeenCalledTimes(1);
		expect(reloadNowResults).toEqual([{ ok: true, sessionId: "s1" }]);
	});

	it("a fallback hands the lazy owner the replacement id", async () => {
		const reloadSession = vi.fn().mockResolvedValue({
			resumed: false,
			reason: "resume-failed",
			sessionId: "s2",
		});
		const { result, reloadNowResults } = setup({ reloadSession }, [msg()]);

		await result.current.handleReload(false);

		expect(reloadNowResults).toEqual([{ ok: true, sessionId: "s2" }]);
	});

	it("a fallback that created no session is reported to the lazy owner as a failure", async () => {
		const reloadSession = vi.fn().mockResolvedValue({
			resumed: false,
			reason: "resume-failed",
			sessionId: null,
		});
		const { result, reloadNowResults } = setup({ reloadSession }, [msg()]);

		await result.current.handleReload(false);

		expect(reloadNowResults).toHaveLength(1);
		expect(reloadNowResults[0].ok).toBe(false);
	});

	it("does not reload behind the owner's back when the lazy owner isn't wired", async () => {
		const reloadSession = vi
			.fn()
			.mockResolvedValue({ resumed: true, sessionId: "s1" });
		const { result } = setup({ reloadSession }, [msg()], {
			wireReloadNow: false,
		});
		noticeMessages.length = 0;

		await result.current.handleReload(false);

		expect(reloadSession).not.toHaveBeenCalled();
		expect(noticeMessages).toContain("[Agent Console] Failed to reload session");
	});
});
