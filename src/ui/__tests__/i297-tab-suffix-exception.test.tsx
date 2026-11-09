/**
 * I297 — the "(2)" collision suffix is a tab-only display aid for auto titles.
 *
 * Session History Invariants § 6, exception (decided 11/09): when an AI title
 * matches another open tab's label, the tab shows "Title (2)", but the saved
 * record and its history row keep the plain title. Rename with AI (F15) is a
 * rename: the record takes the suffixed name, so tab and row agree.
 *
 * Runtime split this pins:
 * - Auto title: `ChatPanel` hands `agent.suggestedTitle` to the tab through
 *   `onLabelChange` → `ChatView.handleTabLabelChange` (truncate + suffix
 *   against the OTHER open tabs), and separately the same raw title to the
 *   record through `useSessionHistory.applySessionTitle` →
 *   `SessionStore.applySuggestedTitle`.
 * - Rename with AI: `ChatView` runs `decideAiTitleApply` and passes its label
 *   to `applyTabRename` → `setTabLabel(custom)` + `SessionStore.renameSession`.
 *
 * Real `useTabManager`, real `SessionStore`, real `decideAiTitleApply`, real
 * history modal content. The two ChatView callbacks are inline in the
 * component, so their argument shapes are mirrored exactly (as in the I227
 * test); the store sits behind an in-memory port (the settings boundary).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { App } from "obsidian";
import { useTabManager } from "../../hooks/useTabManager";
import { suffixOnCollision, truncateLabel } from "../../utils/tab-label";
import { decideAiTitleApply } from "../../resolvers/ai-title-apply";
import {
	SessionStore,
	type SessionStorePort,
} from "../../services/session-store";
import { SessionHistoryContent } from "../SessionHistoryModal";
import type { SavedSessionInfo, SessionInfo } from "../../types/session";

const TITLE = "Greet and offer help";
const KIRO_SID = "eebb5dd2-kiro";
const CLAUDE_SID = "2e571c1b-claude";

class MemoryPort implements SessionStorePort {
	sessions: SavedSessionInfo[] = [];
	getSavedSessions(): SavedSessionInfo[] {
		return this.sessions;
	}
	saveSession = async (info: SavedSessionInfo): Promise<void> => {
		const i = this.sessions.findIndex((s) => s.recordId === info.recordId);
		if (i >= 0) this.sessions[i] = info;
		else this.sessions.unshift(info);
	};
}

type TabManager = ReturnType<typeof useTabManager>;

/** `ChatView.handleTabLabelChange` for an auto-applied (non-custom) label. */
function applyAutoTabLabel(tm: TabManager, tabId: string, label: string) {
	const otherLabels = tm.tabs
		.filter((t) => t.tabId !== tabId)
		.map((t) => t.label);
	tm.setTabLabel(tabId, suffixOnCollision(truncateLabel(label), otherLabels));
}

/** Two open tabs, Kiro CLI and Claude Code, as in the I297 report. */
function twoTabs() {
	const hook = renderHook(() => useTabManager("kiro-cli"));
	const kiroTab = hook.result.current.activeTab!.tabId;
	let claudeTab = "";
	act(() => {
		claudeTab = hook.result.current.addTab("claude-code-acp");
	});
	return { hook, kiroTab, claudeTab };
}

/** Render the Local history list from the saved records, as `fetchSessions("local")` maps them. */
function historyRowTitles(saved: SavedSessionInfo[]): string[] {
	const sessions: SessionInfo[] = saved.map((s) => ({
		sessionId: s.sessionId,
		cwd: s.cwd,
		title: s.title,
		updatedAt: s.updatedAt,
		agentId: s.agentId,
	}));
	render(
		<SessionHistoryContent
			app={new App()}
			sessions={sessions}
			loading={false}
			error={null}
			hasMore={false}
			currentCwd="/vault"
			loadSessionMessages={vi.fn(async () => null)}
			capabilities={{
				listsSessions: false,
				restoresViaLoad: true,
				restoresViaResume: false,
				forks: false,
				closesSessions: false,
				deletesSessions: false,
				reportsModels: false,
			}}
			localSessionIds={new Set(saved.map((s) => s.sessionId))}
			isAgentReady
			debugMode={false}
			initialSource="local"
			agentSessionCache={null}
			agentLabels={{
				"kiro-cli": "Kiro CLI",
				"claude-code-acp": "Claude Code",
			}}
			currentAgentLabel="Kiro CLI"
			onRestoreSession={vi.fn(async () => {})}
			onForkSession={vi.fn(async () => {})}
			onDeleteSession={vi.fn()}
			onEditTitle={vi.fn()}
			onLoadMore={vi.fn()}
			onFetchSessions={vi.fn()}
			onSourceChange={vi.fn()}
			onClose={vi.fn()}
		/>,
	);
	return Array.from(
		document.querySelectorAll(".agent-client-session-history-item-title"),
	).map((el) => el.textContent ?? "");
}

describe("I297 — the collision suffix stays on the tab", () => {
	afterEach(cleanup);

	// The record gets the AI title from two writers, both fed the raw
	// `agent.suggestedTitle`: the title write (ChatPanel → applySessionTitle)
	// and the turn-end save (ChatPanel → saveSessionMessages → recordTurnSave).
	const recordWriters = {
		"title write": (
			store: SessionStore,
			sessionId: string,
			agentId: string,
		) =>
			store.applySuggestedTitle({
				recordId: null,
				sessionId,
				agentId,
				cwd: "/vault",
				suggestedTitle: TITLE,
			}),
		"turn-end save": (
			store: SessionStore,
			sessionId: string,
			agentId: string,
		) =>
			store.recordTurnSave({
				recordId: null,
				sessionId,
				agentId,
				cwd: "/vault",
				messages: [
					{
						id: `${sessionId}-u1`,
						role: "user",
						content: [{ type: "text", text: "hi" }],
						timestamp: new Date("2026-11-08T10:00:00Z"),
					},
				],
				suggestedTitle: TITLE,
			}),
	};

	it.each(Object.keys(recordWriters) as (keyof typeof recordWriters)[])(
		"auto title via %s: the second tab gets (2); both records and history rows keep the plain title",
		async (writer) => {
			const { hook, kiroTab, claudeTab } = twoTabs();
			const port = new MemoryPort();
			const store = new SessionStore(port);

			// Each tab's first reply resolves the same AI title.
			for (const [tabId, sessionId, agentId] of [
				[kiroTab, KIRO_SID, "kiro-cli"],
				[claudeTab, CLAUDE_SID, "claude-code-acp"],
			] as const) {
				act(() => applyAutoTabLabel(hook.result.current, tabId, TITLE));
				await recordWriters[writer](store, sessionId, agentId);
			}

			const label = (id: string) =>
				hook.result.current.tabs.find((t) => t.tabId === id)?.label;
			expect(label(kiroTab)).toBe(TITLE);
			expect(label(claudeTab)).toBe(`${TITLE} (2)`);

			const titleOf = (sid: string) =>
				port.sessions.find((s) => s.sessionId === sid)?.title;
			expect(titleOf(KIRO_SID)).toBe(TITLE);
			expect(titleOf(CLAUDE_SID)).toBe(TITLE);

			expect(historyRowTitles(port.sessions)).toEqual([TITLE, TITLE]);
		},
	);

	it("Rename with AI: the suffixed name is written to the record, so tab and row agree", async () => {
		const { hook, kiroTab, claudeTab } = twoTabs();
		const port = new MemoryPort();
		const store = new SessionStore(port);
		await store.applySuggestedTitle({
			recordId: null,
			sessionId: KIRO_SID,
			agentId: "kiro-cli",
			cwd: "/vault",
			suggestedTitle: TITLE,
		});
		await store.applySuggestedTitle({
			recordId: null,
			sessionId: CLAUDE_SID,
			agentId: "claude-code-acp",
			cwd: "/vault",
			suggestedTitle: "Say hello",
		});
		act(() => {
			hook.result.current.setTabLabel(kiroTab, TITLE);
			hook.result.current.setTabLabel(claudeTab, "Say hello");
		});

		// The user asks for an AI title on the Claude tab; it comes back as the
		// Kiro tab's name (ChatView's Rename-with-AI handler).
		const tabs = hook.result.current.tabs;
		const decision = decideAiTitleApply({
			labelAtStart: "Say hello",
			currentLabel:
				tabs.find((t) => t.tabId === claudeTab)?.label ?? null,
			title: TITLE,
			otherLabels: tabs
				.filter((t) => t.tabId !== claudeTab)
				.map((t) => t.label),
		});
		expect(decision).toEqual({ kind: "apply", label: `${TITLE} (2)` });
		if (decision.kind !== "apply") return;

		// applyTabRename: custom tab label + single-writer rename.
		act(() =>
			hook.result.current.setTabLabel(claudeTab, decision.label, true),
		);
		await store.renameSession({
			recordId: null,
			sessionId: CLAUDE_SID,
			agentId: "claude-code-acp",
			cwd: "",
			title: decision.label,
			createIfMissing: false,
		});

		expect(
			hook.result.current.tabs.find((t) => t.tabId === claudeTab)?.label,
		).toBe(`${TITLE} (2)`);
		expect(
			port.sessions.find((s) => s.sessionId === CLAUDE_SID)?.title,
		).toBe(`${TITLE} (2)`);
		expect(historyRowTitles(port.sessions).sort()).toEqual(
			[TITLE, `${TITLE} (2)`].sort(),
		);
	});
});
