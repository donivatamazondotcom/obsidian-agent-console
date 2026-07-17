/**
 * useLandingHistoryModal — opens the session-history modal from the zero-tab
 * landing, where there is NO ChatPanel host (and no live agent) to drive the
 * tab-scoped useHistoryModal.
 *
 * Part of "Close Last Tab to Empty State" ([[Agent Console Close Last Tab to
 * Empty State]]) Slice 4. Decision 3: the landing reuses the SHIPPED
 * session-history modal (not the deferred History view), lifted to the view
 * level. With zero tabs there is no connected agent, so this opens the modal
 * on the LOCAL source only (NO_AGENT_CAPABILITIES) — the whole on-disk history,
 * every agent, every vault. Restore/fork route through ChatView's existing
 * `openSessionInTab`, which spawns a matched-or-new tab (it already works at
 * zero tabs — `activeTab` is null-guarded and falls back to defaultAgentId).
 *
 * This is intentionally separate from useHistoryModal (tab-scoped, agent-aware)
 * so the shipped in-tab path is untouched; the two share the SessionHistoryModal
 * component, not the wiring.
 */

import { useCallback, useEffect, useRef } from "react";
import { FileSystemAdapter, Notice } from "obsidian";
import {
	SessionHistoryModal,
	type SessionHistoryModalProps,
} from "../ui/SessionHistoryModal";
import { NO_AGENT_CAPABILITIES, type SessionInfo } from "../types/session";
import type AgentClientPlugin from "../plugin";
import { t } from "../i18n";

export interface UseLandingHistoryModalReturn {
	/** Open the session-history modal from the zero-tab landing (Local source). */
	openLandingHistory: () => void;
}

export function useLandingHistoryModal(
	plugin: AgentClientPlugin,
	onOpenSessionInTab: (
		sessionId: string,
		cwd: string,
		mode: "restore" | "fork",
	) => void | Promise<void>,
): UseLandingHistoryModalReturn {
	const modalRef = useRef<SessionHistoryModal | null>(null);

	// Read the orchestration callback via a ref so the stable open/refresh
	// callbacks below always call the latest without re-creating the modal.
	const onOpenSessionInTabRef = useRef(onOpenSessionInTab);
	onOpenSessionInTabRef.current = onOpenSessionInTab;

	// Rebuilt every render; invoked at open/refresh time so the props always
	// reflect the current on-disk session list. Held in a ref so the delete /
	// rename / fetch handlers (which live inside the built props) can trigger a
	// refresh through the stable `refresh` callback without a dependency cycle.
	const buildPropsRef = useRef<() => SessionHistoryModalProps>(
		() => ({}) as SessionHistoryModalProps,
	);

	const refresh = useCallback(() => {
		modalRef.current?.updateProps(buildPropsRef.current());
	}, []);

	buildPropsRef.current = (): SessionHistoryModalProps => {
		const saved = plugin.settingsService.getSavedSessions();
		const sessions: SessionInfo[] = saved.map((s) => ({
			sessionId: s.sessionId,
			cwd: s.cwd,
			title: s.title,
			updatedAt: s.updatedAt,
			agentId: s.agentId,
		}));
		const adapter = plugin.app.vault.adapter;
		const currentCwd =
			adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
		const agentLabels = Object.fromEntries(
			plugin.getAvailableAgents().map((a) => [a.id, a.displayName]),
		);
		const defaultAgentId = plugin.settings.defaultAgentId;
		return {
			sessions,
			loading: false,
			error: null,
			hasMore: false,
			currentCwd,
			loadSessionMessages: (sessionId: string) =>
				plugin.settingsService.loadSessionMessages(sessionId),
			// No live agent on the landing → Local source only.
			capabilities: NO_AGENT_CAPABILITIES,
			localSessionIds: new Set(saved.map((s) => s.sessionId)),
			isAgentReady: false,
			debugMode: plugin.settingsService.getSnapshot().debugMode,
			initialSource: "local",
			agentSessionCache: null,
			agentLabels,
			currentAgentLabel: agentLabels[defaultAgentId] ?? defaultAgentId,
			onRestoreSession: async (sessionId: string, cwd: string) => {
				await onOpenSessionInTabRef.current(sessionId, cwd, "restore");
			},
			onForkSession: async (sessionId: string, cwd: string) => {
				await onOpenSessionInTabRef.current(sessionId, cwd, "fork");
			},
			onDeleteSession: async (sessionId: string) => {
				try {
					await plugin.settingsService.deleteSession(sessionId);
					refresh();
				} catch {
					new Notice(t("notices.sessionDeleteFailed"));
				}
			},
			onEditTitle: async (
				sessionId: string,
				newTitle: string,
				sessionCwd: string,
			) => {
				const match = plugin.settingsService
					.getSavedSessions()
					.find((s) => s.sessionId === sessionId);
				try {
					await plugin.settingsService.sessionStore.renameSession({
						sessionId,
						agentId: match?.agentId ?? defaultAgentId,
						cwd: sessionCwd,
						title: newTitle,
						createIfMissing: false,
					});
					refresh();
				} catch {
					new Notice(t("notices.titleUpdateFailed"));
				}
			},
			// Local source is the whole store — no pagination, no server fetch.
			onLoadMore: () => {},
			onFetchSessions: () => refresh(),
			// Local-only on the landing (no agent to switch to); nothing to persist.
			onSourceChange: () => {},
		};
	};

	const openLandingHistory = useCallback(() => {
		if (!modalRef.current) {
			modalRef.current = new SessionHistoryModal(
				plugin.app,
				buildPropsRef.current(),
				() => {
					modalRef.current = null;
				},
			);
		} else {
			modalRef.current.updateProps(buildPropsRef.current());
		}
		modalRef.current.open();
	}, [plugin.app]);

	// Close the modal if the view unmounts while it is open (mirrors
	// useHistoryModal RC-4 — no orphaned modal).
	useEffect(() => {
		return () => {
			modalRef.current?.close();
		};
	}, []);

	return { openLandingHistory };
}
