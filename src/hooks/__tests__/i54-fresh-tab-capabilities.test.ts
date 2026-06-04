/**
 * I54: Fresh lazy tabs lack promptCapabilities until first keystroke.
 *
 * A fresh tab calls acpClient.initialize() eagerly (ChatPanel useEffect),
 * which caches promptCapabilities in the AcpClient. But those capabilities
 * never reach the React session state until createSession runs (on first
 * keystroke). So `supportsImages = session.promptCapabilities?.image` is
 * false, and screenshot paste is blocked until the user types and connects.
 *
 * The fix adds `applyInitCapabilities()` to useAgentSession: it merges the
 * cached getInitializeResult() capabilities into session state WITHOUT
 * creating a session (no sessionId, state stays "disconnected").
 *
 * Test gate per SDLC § Stack-Trace Patch Anti-Pattern:
 * - PRE-FIX: result.current.applyInitCapabilities is undefined → throws → FAILS
 * - POST-FIX: capabilities propagate, sessionId stays null → PASSES
 */

import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAgentSession } from "../useAgentSession";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";

function makeSettings() {
	return {
		defaultAgentId: "auto-sa",
		claude: { id: "auto-sa", displayName: "Auto-SA" },
		codex: { id: "codex", displayName: "Codex" },
		gemini: { id: "gemini", displayName: "Gemini" },
		kiro: { id: "kiro", displayName: "Kiro" },
		customAgents: [],
	};
}

describe("I54: fresh-tab capability propagation", () => {
	it("applyInitCapabilities propagates cached init capabilities into session state without creating a session", () => {
		const initResult = {
			promptCapabilities: { image: true },
			agentCapabilities: {},
		};
		const agentClient = {
			getInitializeResult: vi.fn(() => initResult),
		} as unknown as AcpClient;
		const settingsAccess = {
			getSnapshot: () => makeSettings(),
		} as unknown as ISettingsAccess;

		const { result } = renderHook(() =>
			useAgentSession(agentClient, settingsAccess, "/cwd", () => {}, "auto-sa"),
		);

		// Fresh tab, no createSession yet → capabilities absent (the bug).
		expect(result.current.session.promptCapabilities).toBeUndefined();
		expect(result.current.session.sessionId).toBeNull();
		expect(result.current.session.state).toBe("disconnected");

		// Propagate the eager-init capabilities.
		act(() => result.current.applyInitCapabilities());

		// Capabilities now available → image paste enabled before connection.
		expect(result.current.session.promptCapabilities?.image).toBe(true);

		// CRITICAL invariant: must NOT look connected. No session was created.
		expect(result.current.session.sessionId).toBeNull();
		expect(result.current.session.state).toBe("disconnected");
	});

	it("applyInitCapabilities is a no-op when no init result is cached yet", () => {
		const agentClient = {
			getInitializeResult: vi.fn(() => null),
		} as unknown as AcpClient;
		const settingsAccess = {
			getSnapshot: () => makeSettings(),
		} as unknown as ISettingsAccess;

		const { result } = renderHook(() =>
			useAgentSession(agentClient, settingsAccess, "/cwd", () => {}, "auto-sa"),
		);

		act(() => result.current.applyInitCapabilities());

		expect(result.current.session.promptCapabilities).toBeUndefined();
		expect(result.current.session.sessionId).toBeNull();
	});
});
