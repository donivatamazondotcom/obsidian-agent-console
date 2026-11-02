/**
 * I223 — reproduce-first, at the hook seam: a tab restored from the agent's
 * session list (no local record) saves its record under the agent's title.
 *
 * ChatView hands the history row's title to the restored tab, and ChatPanel
 * passes it to `useSessionHistory` as `restoredAgentTitle`. Every save the tab
 * makes (turn end, context-note change, debounced) goes through
 * `saveSessionMessages`, which forwards it to the single writer
 * (`SessionStore.recordTurnSave`) as a create-only seed. Only the settings
 * port is faked; the real SessionStore runs.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useSessionHistory } from "../useSessionHistory";
import type { ISettingsAccess } from "../../services/settings-service";
import type { AcpClient } from "../../acp/acp-client";
import type { ChatSession, SavedSessionInfo } from "../../types/session";
import type { ChatMessage } from "../../types/chat";

const AGENT_TITLE = "Kiro integration with Obsidian";

function makeSettings() {
	let savedSessions: SavedSessionInfo[] = [];
	const api = {
		getSavedSessions: () => savedSessions,
		getSnapshot: () => ({ savedSessions }),
		saveSession: vi.fn(async (info: SavedSessionInfo) => {
			savedSessions = [
				...savedSessions.filter((s) => s.sessionId !== info.sessionId),
				info,
			];
		}),
		saveSessionMessages: vi.fn(async () => {}),
		loadSessionMessages: vi.fn(async () => null),
		loadSessionContextNotes: vi.fn(async () => null),
		subscribe: vi.fn(() => () => {}),
		get saved() {
			return savedSessions;
		},
	};
	return api as unknown as ISettingsAccess & typeof api;
}

const session = {
	sessionId: "sess_1",
	agentId: "kiro",
	state: "ready",
	authMethods: [],
	capabilities: {
		listsSessions: true,
		restoresViaLoad: true,
		restoresViaResume: false,
		forks: false,
		closesSessions: false,
		reportsModels: false,
	},
} as unknown as ChatSession;

const replayed: ChatMessage[] = [
	{ id: "u", role: "user", content: [{ type: "text", text: "set up the Kiro plugin" }], timestamp: new Date() },
	{ id: "a", role: "assistant", content: [{ type: "text", text: "Done." }], timestamp: new Date() },
];

function render(restoredAgentTitle?: string) {
	const settings = makeSettings();
	const hook = renderHook(() =>
		useSessionHistory({
			agentClient: {} as AcpClient,
			session,
			settingsAccess: settings,
			cwd: "/vault",
			agentCwd: "/vault",
			onSessionLoad: vi.fn(),
			restoredAgentTitle,
		} as Parameters<typeof useSessionHistory>[0]),
	);
	return { hook, settings };
}

describe("I223 — restored agent-only tab saves the agent's title", () => {
	it("first save creates the record titled with the agent's title", async () => {
		const { hook, settings } = render(AGENT_TITLE);
		await act(async () => {
			await hook.result.current.saveSessionMessages("sess_1", replayed);
			await new Promise((r) => setTimeout(r, 0));
		});
		expect(settings.saved[0]?.title).toBe(AGENT_TITLE);
	});

	it("without an agent title the first message still names the record", async () => {
		const { hook, settings } = render(undefined);
		await act(async () => {
			await hook.result.current.saveSessionMessages("sess_1", replayed);
			await new Promise((r) => setTimeout(r, 0));
		});
		expect(settings.saved[0]?.title).toBe("set up the Kiro plugin");
	});
});
