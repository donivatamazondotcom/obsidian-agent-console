import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useLazySession } from "../useLazySession";
import {
	decideSessionIntent,
	selectAcquisitionAgent,
} from "../../utils/agent-switch";
import { checkTabAgentInvariant } from "../../utils/tab-agent-invariant";

/**
 * Slice 2 reproduce-first — "switch agent on a tab with a live session, then
 * type, then send" must connect the NEXT message to the SWITCHED agent through
 * a SINGLE session/new owned by useLazySession.
 *
 * Per the TP-I05 lesson ([[Tab Agent Identity and Session Acquisition
 * Unification]] § Shipped slices), the reproduce-first test models the FULL
 * boundary (acquire → switch → re-acquire → send) with the REAL useLazySession
 * hook and the REAL pure decision — not a hard-coded sub-path.
 *
 * The unification makes handleNewChatWithPersist a lazy-machine intent
 * dispatcher: a recreate-lazy switch tears down the session, rebinds the agent
 * (setAgentWithoutSession), and RESETS the lazy machine — deferring acquisition
 * to the next send. The `reset()` is load-bearing: without it the hook stays
 * sticky on the OLD session and the next message goes to the OLD agent (the
 * wrong-agent / I53 class). The two tests below are the GREEN (with reset) and
 * RED (without reset) sides of that contrast.
 */

interface Harness {
	/** Mutable "source of truth" the acquisition reads — mirrors session.agentId,
	 *  updated by setAgentWithoutSession on a switch. */
	liveAgent: string;
	creates: string[];
	sends: Array<{ sessionId: string; agent: string }>;
	result: { current: ReturnType<typeof useLazySession> };
	/** Mirror of setAgentWithoutSession: rebind the agent, drop the live session. */
	setAgentWithoutSession: (agentId: string) => void;
}

function mountHarness(startAgent: string): Harness {
	const state = { liveAgent: startAgent };
	const creates: string[] = [];
	const sends: Array<{ sessionId: string; agent: string }> = [];
	let counter = 0;

	const acquireNewSession = vi.fn(async () => {
		// Exactly what ChatPanel's acquireNewSession does: read the live agent.
		const effective = selectAcquisitionAgent(state.liveAgent, undefined);
		creates.push(effective as string);
		counter += 1;
		return { ok: true as const, sessionId: `sess-${effective}-${counter}` };
	});
	const loadExistingSession = vi.fn(async () => ({
		ok: true as const,
		sessionId: "unused",
	}));
	const sendPrompt = vi.fn(async (sessionId: string) => {
		sends.push({ sessionId, agent: state.liveAgent });
	});

	const { result } = renderHook(() =>
		useLazySession({
			acquireNewSession,
			loadExistingSession,
			sendPrompt,
			debounceMs: 0,
		}),
	);

	return {
		get liveAgent() {
			return state.liveAgent;
		},
		creates,
		sends,
		result,
		setAgentWithoutSession: (agentId: string) => {
			state.liveAgent = agentId;
		},
	};
}

/** Drive the typing-as-intent debounce to completion. */
async function typeAndSettle(h: Harness, text = "hello"): Promise<void> {
	act(() => h.result.current.onComposerChange(text));
	await act(async () => {
		await new Promise((r) => setTimeout(r, 5));
	});
}

describe("Slice 2 — switch-then-send (recreate-lazy) drives the lazy machine", () => {
	it("GREEN: switch on an active tab + reset + type → one new session/new bound to the switched agent", async () => {
		const h = mountHarness("test-agent");

		// 1. Fresh tab on test-agent: first type acquires a session.
		await typeAndSettle(h);
		expect(h.creates).toEqual(["test-agent"]);
		expect(h.result.current.sessionId).toBe("sess-test-agent-1");

		// 2. User switches to claude-code on the now-active tab. The dispatcher
		//    resolves recreate-lazy (has session) and applies the orchestration:
		//    rebind agent + reset the lazy machine (NO eager createSession).
		const decision = decideSessionIntent({
			intent: "switch-agent",
			currentAgentId: "test-agent",
			requestedAgentId: "claude-code",
			hasSession: true,
			messageCount: 3,
		});
		expect(decision).toEqual({ kind: "recreate-lazy", agentId: "claude-code" });
		act(() => {
			h.setAgentWithoutSession(decision.kind === "recreate-lazy" ? decision.agentId : "test-agent");
			h.result.current.reset();
		});
		expect(h.result.current.sessionId).toBeNull(); // machine back to idle

		// 3. User types → the SOLE owner acquires once, against claude-code.
		await typeAndSettle(h, "switched");
		expect(h.creates).toEqual(["test-agent", "claude-code"]); // exactly one new
		expect(h.result.current.sessionId).toBe("sess-claude-code-2");

		// 4. Send goes to the claude-code session — invariant holds.
		act(() => h.result.current.onSendClick("do the thing"));
		expect(h.sends).toHaveLength(1);
		expect(h.sends[0].sessionId).toBe("sess-claude-code-2");
		expect(
			checkTabAgentInvariant({
				selectedAgentId: "claude-code",
				liveSessionAgentId: h.sends[0].agent,
			}),
		).toBeNull();
	});

	it("RED contrast: without reset(), the lazy machine stays sticky on the OLD session — the bug", async () => {
		const h = mountHarness("test-agent");

		await typeAndSettle(h);
		expect(h.result.current.sessionId).toBe("sess-test-agent-1");

		// Switch the live agent but SKIP reset() (the pre-fix recreate path
		// that left the machine sticky). The hook still holds the old session.
		act(() => {
			h.setAgentWithoutSession("claude-code");
		});

		// Typing is a no-op (sticky session), so claude-code is never acquired.
		await typeAndSettle(h, "switched");
		expect(h.creates).toEqual(["test-agent"]); // claude-code NEVER acquired

		// The message lands on the OLD test-agent session → invariant VIOLATED.
		act(() => h.result.current.onSendClick("do the thing"));
		expect(h.sends[0].sessionId).toBe("sess-test-agent-1");
		const violation = checkTabAgentInvariant({
			selectedAgentId: "claude-code", // what the user selected
			liveSessionAgentId: "test-agent", // what the sticky session is bound to
		});
		expect(violation).not.toBeNull();
		expect(violation?.code).toBe("tab-agent-mismatch");
	});
});
