import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useLazySession } from "../useLazySession";
import { decideSessionIntent } from "../../resolvers/agent-switch";
import { retireLiveSession } from "../../services/retire-live-session";
import { AcpTypeConverter } from "../../acp/type-converter";
import type { RawAgentCapabilities } from "../../types/session";

/**
 * I210 reproduce-first boundary test. In-tab New chat on a live subprocess
 * must leave exactly ONE live session and ONE MCP set, on both Kiro engines.
 *
 * Real pieces: useLazySession (the sole session/new owner), decideSessionIntent
 * (the decision), retireLiveSession (the executor), and the capability
 * normalizer fed the raw `initialize` shapes probed on 2026-10-27.
 *
 * Fake: the agent subprocess. Its MCP model matches the I210 measurements:
 * - V2: every session/new on a live process starts a new MCP set and keeps
 *   the earlier ones (one set per live session). No session/close.
 * - V3: one MCP set per process, and session/close is advertised.
 * A respawn (disconnect, then initialize) frees every set on the process.
 */

const PROBES: Record<"v2" | "v3", RawAgentCapabilities> = {
	v2: { loadSession: true, sessionCapabilities: {} },
	v3: {
		loadSession: true,
		sessionCapabilities: { list: {}, close: {}, fork: {} },
	},
};

class FakeAgentProcess {
	alive = false;
	spawns = 0;
	respawns = 0;
	sessionNews = 0;
	closes = 0;
	readonly liveSessions = new Set<string>();
	private counter = 0;

	constructor(readonly engine: "v2" | "v3") {}

	get mcpSets(): number {
		if (!this.alive) return 0;
		if (this.engine === "v2") return this.liveSessions.size;
		return this.liveSessions.size > 0 ? 1 : 0;
	}

	initialize(): void {
		this.alive = true;
		this.spawns += 1;
		this.liveSessions.clear();
	}

	newSession(): string {
		if (!this.alive) throw new Error("not initialized");
		this.sessionNews += 1;
		this.counter += 1;
		const id = `${this.engine}-sess-${this.counter}`;
		this.liveSessions.add(id);
		return id;
	}

	closeSession(id: string): void {
		if (PROBES[this.engine].sessionCapabilities?.close === undefined) {
			throw new Error("Method not found: session/close");
		}
		this.closes += 1;
		this.liveSessions.delete(id);
	}

	disconnect(): void {
		if (this.alive) this.respawns += 1;
		this.alive = false;
		this.liveSessions.clear();
	}
}

function mount(engine: "v2" | "v3") {
	const proc = new FakeAgentProcess(engine);
	const caps = AcpTypeConverter.toAgentCapabilities(PROBES[engine]);

	const { result } = renderHook(() =>
		useLazySession({
			// Mirrors useAgentSession.createSession: initialize only when the
			// process isn't up (same agent), then session/new on it.
			acquireNewSession: async () => {
				if (!proc.alive) proc.initialize();
				return { ok: true as const, sessionId: proc.newSession() };
			},
			loadExistingSession: async () => ({
				ok: false as const,
				error: new Error("no restore in this test"),
			}),
			sendPrompt: async () => undefined,
			debounceMs: 0,
		}),
	);

	// Mirrors ChatPanel.handleNewChatWithPersist for an in-tab New chat.
	const newChat = async () => {
		const live = result.current.sessionId;
		const decision = decideSessionIntent({
			intent: "new-chat",
			currentAgentId: "kiro-cli",
			hasSession: live !== null,
			messageCount: 2,
			closesSessions: caps.closesSessions,
		});
		if (decision.kind !== "recreate-eager") {
			throw new Error(`unexpected decision ${decision.kind}`);
		}
		await retireLiveSession(decision.retire, {
			closeLiveSession: async () => {
				if (live) proc.closeSession(live);
			},
			respawn: async () => proc.disconnect(),
			warn: () => undefined,
		});
		await act(async () => {
			await result.current.acquireNow();
		});
	};

	return { proc, result, newChat };
}

describe("I210 — in-tab New chat keeps one MCP set per tab", () => {
	it("V2 (no session/close): each New chat respawns; one set, one live session", async () => {
		const { proc, result, newChat } = mount("v2");
		await act(async () => {
			await result.current.acquireNow();
		});
		expect(proc.mcpSets).toBe(1);

		await newChat();
		await newChat();

		expect(proc.liveSessions.size).toBe(1);
		expect(proc.mcpSets).toBe(1);
		expect(proc.respawns).toBe(2);
		expect(proc.closes).toBe(0);
		expect(proc.sessionNews).toBe(3);
		expect(result.current.sessionId).toBe([...proc.liveSessions][0]);
	});

	it("V3 (session/close): each New chat closes the old session on the same process", async () => {
		const { proc, result, newChat } = mount("v3");
		await act(async () => {
			await result.current.acquireNow();
		});

		await newChat();
		await newChat();

		expect(proc.liveSessions.size).toBe(1);
		expect(proc.mcpSets).toBe(1);
		expect(proc.closes).toBe(2);
		expect(proc.respawns).toBe(0);
		expect(proc.spawns).toBe(1);
		expect(result.current.sessionId).toBe([...proc.liveSessions][0]);
	});
});
