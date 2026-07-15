/**
 * I174 — reproduce-first test: Stop during a pending permission must not
 * kill future permission notifications for the session.
 *
 * Bug: `useAgent.cancelOperation` runs `discardPendingTurn()` →
 * `PermissionManager.cancelAll()` (which ENQUEUES the `isActive: false`
 * cancellation through the batched update queue) → `clearPendingUpdates()`,
 * which wipes the queue and discards that cancellation. The stale permission
 * block stays `isActive: true` in messages, so `hasActivePermission` never
 * resets — and the notification effect's `!wasActive && hasActivePermission`
 * transition never fires again for the session.
 *
 * These tests exercise the REAL `useAgentMessages` hook: apply a permission,
 * run the stop-path discard (with the cancellation update lost, as in
 * production), and assert `hasActivePermission` resets and a SECOND
 * permission re-arms the transition.
 *
 * RED against the unfixed hook (hasActivePermission stays true after stop).
 * Spec: [[I174 Stop during pending permission kills future permission
 * notifications]].
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgentMessages } from "../useAgentMessages";
import type { AcpClient } from "../../acp/acp-client";
import type { ISettingsAccess } from "../../services/settings-service";
import type { IVaultAccess } from "../../services/vault-service";
import type { IMentionService } from "../../utils/mention-parser";
import type { ChatSession } from "../../types/session";
import type { ErrorInfo } from "../../types/errors";
import type { SessionUpdate } from "../../types/session";

function makeDeps() {
	const agentClient = {} as unknown as AcpClient;
	const settingsAccess = {
		getSnapshot: () => ({
			titleStrategy: "agent-timestamp",
			windowsWslMode: false,
		}),
	} as unknown as ISettingsAccess;
	const vaultAccess = {} as unknown as IVaultAccess & IMentionService;
	const session = {
		sessionId: "s1",
		authMethods: [],
		promptCapabilities: { embeddedContext: false, image: false, audio: false },
	} as unknown as ChatSession;
	const setErrorInfo = vi.fn<(e: ErrorInfo | null) => void>();
	return { agentClient, settingsAccess, vaultAccess, session, setErrorInfo };
}

function permissionUpdate(toolCallId: string, requestId: string): SessionUpdate {
	return {
		type: "tool_call",
		sessionId: "s1",
		toolCallId,
		title: "Write file",
		status: "pending",
		kind: "edit",
		permissionRequest: {
			requestId,
			options: [
				{ optionId: "allow", name: "Allow", kind: "allow_once" },
				{ optionId: "reject", name: "Reject", kind: "reject_once" },
			],
			isActive: true,
		},
	} as unknown as SessionUpdate;
}

async function flushBatch() {
	// The flush scheduler runs on rAF (visible) — jsdom provides rAF; wait a tick.
	await act(async () => {
		await new Promise((res) => requestAnimationFrame(() => res(null)));
		await new Promise((res) => setTimeout(res, 0));
	});
}

describe("I174 — stop during pending permission", () => {
	it("clears hasActivePermission when the turn is discarded (stop path)", async () => {
		const d = makeDeps();
		const { result } = renderHook(() =>
			useAgentMessages(
				d.agentClient,
				d.settingsAccess,
				d.vaultAccess,
				d.session,
				d.setErrorInfo,
			),
		);

		act(() => {
			result.current.enqueueUpdate(permissionUpdate("tc-1", "req-1"));
		});
		await flushBatch();
		expect(result.current.hasActivePermission).toBe(true);

		// Production stop path: discardPendingTurn + clearPendingUpdates run,
		// and the PermissionManager's cancellation update is LOST (wiped from
		// the queue before flushing) — modeled by simply not delivering it.
		act(() => {
			result.current.discardPendingTurn();
			result.current.clearPendingUpdates();
		});
		await flushBatch();

		expect(result.current.hasActivePermission).toBe(false);
	});

	it("a permission arriving AFTER the stop re-arms the inactive→active transition", async () => {
		const d = makeDeps();
		const { result } = renderHook(() =>
			useAgentMessages(
				d.agentClient,
				d.settingsAccess,
				d.vaultAccess,
				d.session,
				d.setErrorInfo,
			),
		);

		act(() => {
			result.current.enqueueUpdate(permissionUpdate("tc-1", "req-1"));
		});
		await flushBatch();
		act(() => {
			result.current.discardPendingTurn();
			result.current.clearPendingUpdates();
		});
		await flushBatch();
		expect(result.current.hasActivePermission).toBe(false);

		// Next turn raises a new permission — the transition the notification
		// effect keys on must be observable again (false → true).
		act(() => {
			result.current.enqueueUpdate(permissionUpdate("tc-2", "req-2"));
		});
		await flushBatch();
		expect(result.current.hasActivePermission).toBe(true);
		expect(result.current.activePermission?.requestId).toBe("req-2");
	});
});
