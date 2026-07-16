import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLazySession, type UseLazySessionOptions } from "../useLazySession";
import { useTabManager } from "../useTabManager";
import { decideSessionIntent } from "../../resolvers/agent-switch";

function makeOptions(
	overrides: Partial<UseLazySessionOptions> = {},
): UseLazySessionOptions {
	return {
		acquireNewSession: vi
			.fn()
			.mockResolvedValue({ ok: true, sessionId: "fresh-session" }),
		loadExistingSession: vi
			.fn()
			.mockResolvedValue({ ok: true, sessionId: "restored-session" }),
		sendPrompt: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

function originOf(value: unknown): string | undefined {
	return (value as { origin?: string }).origin;
}

describe("origin-aware acquisition — useLazySession", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
	});

	it("eager fresh mount acquires once without typing", async () => {
		const options = makeOptions();
		const { result } = renderHook(() =>
			useLazySession({ ...options, eagerAcquire: true }),
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});

		expect(options.acquireNewSession).toHaveBeenCalledTimes(1);
		expect(options.loadExistingSession).not.toHaveBeenCalled();
		expect(result.current.state).toBe("ready");
		expect(result.current.sessionId).toBe("fresh-session");
	});

	it("eager restored acquisition preserves load-before-new precedence", async () => {
		const options = makeOptions();
		const { result } = renderHook(() =>
			useLazySession({
				...options,
				restoredSessionId: "saved-session",
				eagerAcquire: true,
			}),
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});

		expect(options.loadExistingSession).toHaveBeenCalledWith(
			"saved-session",
		);
		expect(options.acquireNewSession).not.toHaveBeenCalled();
		expect(result.current.sessionId).toBe("restored-session");
	});

	it("stays idle when eagerAcquire is false", async () => {
		const options = makeOptions();
		const { result } = renderHook(() =>
			useLazySession({ ...options, eagerAcquire: false }),
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(500);
		});

		expect(options.acquireNewSession).not.toHaveBeenCalled();
		expect(options.loadExistingSession).not.toHaveBeenCalled();
		expect(result.current.state).toBe("idle");
	});

	it("acquires exactly once when readiness flips eagerAcquire to true", async () => {
		const options = makeOptions();
		const { result, rerender } = renderHook(
			({ eager }: { eager: boolean }) =>
				useLazySession({ ...options, eagerAcquire: eager }),
			{ initialProps: { eager: false } },
		);

		rerender({ eager: true });
		rerender({ eager: true });
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		rerender({ eager: true });

		expect(options.acquireNewSession).toHaveBeenCalledTimes(1);
		expect(result.current.sessionId).toBe("fresh-session");
	});

	it("a failed eager acquisition surfaces error and a later send retries", async () => {
		const acquireNewSession = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, error: new Error("offline") })
			.mockResolvedValueOnce({ ok: true, sessionId: "retry-session" });
		const options = makeOptions({ acquireNewSession });
		const { result } = renderHook(() =>
			useLazySession({ ...options, eagerAcquire: true }),
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(result.current.state).toBe("error");
		expect(result.current.sessionId).toBeNull();

		await act(async () => {
			result.current.onSendClick("retry");
			await vi.advanceTimersByTimeAsync(0);
		});

		expect(acquireNewSession).toHaveBeenCalledTimes(2);
		expect(result.current.state).toBe("ready");
		expect(result.current.sessionId).toBe("retry-session");
	});

	it("fresh paste after eager readiness cannot create a duplicate session", async () => {
		const options = makeOptions();
		const { result } = renderHook(() =>
			useLazySession({ ...options, eagerAcquire: true }),
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(result.current.state).toBe("ready");

		act(() => result.current.onComposerChange("pasted text"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(500);
		});

		expect(options.acquireNewSession).toHaveBeenCalledTimes(1);
		expect(result.current.sessionId).toBe("fresh-session");
	});

	it("typing before eager readiness cannot leave a duplicate acquisition timer", async () => {
		const options = makeOptions();
		const { result, rerender } = renderHook(
			({ eager }: { eager: boolean }) =>
				useLazySession({ ...options, eagerAcquire: eager }),
			{ initialProps: { eager: false } },
		);

		act(() => result.current.onComposerChange("typed during initialize"));
		rerender({ eager: true });
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(result.current.state).toBe("ready");

		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});

		expect(options.acquireNewSession).toHaveBeenCalledTimes(1);
		expect(result.current.sessionId).toBe("fresh-session");
	});
});

describe("origin-aware acquisition — runtime tab origins", () => {
	it("marks the initial no-persistence tab fresh", () => {
		const { result } = renderHook(() => useTabManager("kiro-cli"));
		expect(originOf(result.current.tabs[0])).toBe("fresh");
	});

	it("marks addTab fresh by default", () => {
		const { result } = renderHook(() => useTabManager("kiro-cli"));
		let tabId = "";
		act(() => {
			tabId = result.current.addTab("claude-code");
		});
		const added = result.current.tabs.find((tab) => tab.tabId === tabId);
		expect(originOf(added)).toBe("fresh");
	});

	it("accepts restored origin for undo-close and history restore call sites", () => {
		const { result } = renderHook(() => useTabManager("kiro-cli", [], ""));
		const addTab = result.current.addTab as (
			agentId: string,
			label?: string,
			activate?: boolean,
			origin?: "fresh" | "restored",
		) => string;
		let tabId = "";
		act(() => {
			tabId = addTab("kiro-cli", "Restored chat", true, "restored");
		});
		const added = result.current.tabs.find((tab) => tab.tabId === tabId);
		expect(originOf(added)).toBe("restored");
	});
});

describe("origin-aware acquisition — deliberate fresh intents", () => {
	it("New chat requests immediate reacquisition through the lazy owner", () => {
		expect(
			decideSessionIntent({
				intent: "new-chat",
				currentAgentId: "kiro-cli",
				hasSession: true,
				messageCount: 3,
			}),
		).toEqual({ kind: "recreate-eager", agentId: "kiro-cli" });
	});

	it("New chat in directory requests immediate reacquisition", () => {
		expect(
			decideSessionIntent({
				intent: "new-chat-in-directory",
				currentAgentId: "kiro-cli",
				hasSession: false,
				messageCount: 0,
			}),
		).toEqual({ kind: "recreate-eager", agentId: "kiro-cli" });
	});

	it("agent switching remains lazy", () => {
		expect(
			decideSessionIntent({
				intent: "switch-agent",
				currentAgentId: "kiro-cli",
				requestedAgentId: "claude-code",
				hasSession: true,
				messageCount: 3,
			}),
		).toEqual({ kind: "recreate-lazy", agentId: "claude-code" });
	});
});

describe("origin-aware acquisition — one-shot eager request", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
	});

	it("does not re-fire automatically after reset", async () => {
		const options = makeOptions();
		const { result } = renderHook(() =>
			useLazySession({ ...options, eagerAcquire: true }),
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});

		act(() => result.current.reset());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});

		expect(options.acquireNewSession).toHaveBeenCalledTimes(1);
		expect(result.current.state).toBe("idle");
		expect(result.current.sessionId).toBeNull();
	});
});
