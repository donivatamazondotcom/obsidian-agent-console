import { useRef, useCallback, useEffect } from "react";
import { Notice } from "obsidian";
import { SessionHistoryModal } from "../ui/SessionHistoryModal";
import { getLogger } from "../utils/logger";
import type AgentClientPlugin from "../plugin";
import type { UseAgentReturn } from "./useAgent";
import type { UseSessionHistoryReturn } from "./useSessionHistory";

/**
 * Hook for managing the session history modal lifecycle.
 *
 * Encapsulates modal creation, props synchronization, and
 * session operation callbacks (restore, fork, delete).
 *
 * @param plugin - Plugin instance for app access
 * @param agent - Agent hook for clearMessages
 * @param sessionHistory - Session history hook for operations
 * @param vaultPath - Current working directory
 * @param isSessionReady - Whether the session is ready
 * @param debugMode - Whether debug mode is enabled
 */
export function useHistoryModal(
	plugin: AgentClientPlugin,
	agent: UseAgentReturn,
	sessionHistory: UseSessionHistoryReturn,
	vaultPath: string,
	isSessionReady: boolean,
	debugMode: boolean,
	onAgentCwdChange?: (cwd: string) => void,
	onLabelChange?: (label: string) => void,
	currentSessionId?: string,
	findTabBySessionId?: (sessionId: string) => { tabId: string; label: string } | null,
	onSwitchToTab?: (tabId: string) => void,
	onCloseTab?: (tabId: string) => void,
	onOpenSessionInTab?: (
		sessionId: string,
		cwd: string,
		mode: "restore" | "fork",
	) => void | Promise<void>,
): {
	handleOpenHistory: () => void;
	handleDeleteSession: (sessionId: string) => Promise<void>;
} {
	const logger = getLogger();
	const historyModalRef = useRef<SessionHistoryModal | null>(null);

	// ── Stable refs for values read at call time ──
	// These prevent callbacks from depending on frequently-changing references
	// (like sessionHistory.sessions which is a new array every render),
	// which would cause the callbacks to be recreated every render,
	// which would cause the useEffect syncing modal props to fire every render,
	// which would call updateProps → root.render() → infinite re-render loop (I11/I12).
	const onLabelChangeRef = useRef(onLabelChange);
	onLabelChangeRef.current = onLabelChange;
	const currentSessionIdRef = useRef(currentSessionId);
	currentSessionIdRef.current = currentSessionId;
	const findTabBySessionIdRef = useRef(findTabBySessionId);
	findTabBySessionIdRef.current = findTabBySessionId;
	const onCloseTabRef = useRef(onCloseTab);
	onCloseTabRef.current = onCloseTab;
	// Orchestration callback (ChatView). Restore/fork open the session in a
	// matched-or-new tab rather than restoring INTO the current one — the
	// target-tab decision, switch-if-open (I20), new-tab seed and lazy
	// reconnect all live in ChatView.onOpenSessionInTab.
	const onOpenSessionInTabRef = useRef(onOpenSessionInTab);
	onOpenSessionInTabRef.current = onOpenSessionInTab;

	const handleRestoreSession = useCallback(
		async (sessionId: string, cwd: string) => {
			// Open the session in a matched-or-new tab via ChatView's
			// orchestration. Restore is gated on data + intent, not connection
			// (I09/I41 superseded); the new tab reconnects lazily on first
			// send, and the active session is never clobbered.
			try {
				logger.log(
					`[ChatPanel] Open session in tab (restore): ${sessionId}`,
				);
				await onOpenSessionInTabRef.current?.(
					sessionId,
					cwd,
					"restore",
				);
			} catch (error) {
				new Notice("[Agent Console] Failed to restore session");
				logger.error("Session restore error:", error);
			}
		},
		[logger],
	);

	const handleDeleteSession = useCallback(
		async (sessionId: string) => {
			try {
				logger.log(`[ChatPanel] Deleting session: ${sessionId}`);
				await sessionHistory.deleteSession(sessionId);
				// If the deleted session is open in a tab, close that tab so the
				// UI doesn't keep an orphaned tab for a session that no longer
				// exists in history. Mirrors the I20 restore-switch wiring.
				const openTab = findTabBySessionIdRef.current?.(sessionId);
				if (openTab) {
					onCloseTabRef.current?.(openTab.tabId);
				}
				new Notice("[Agent Console] Session deleted");
			} catch (error) {
				new Notice("[Agent Console] Failed to delete session");
				logger.error("Session delete error:", error);
			}
		},
		[sessionHistory.deleteSession, logger],
	);

	const handleEditTitle = useCallback(
		async (sessionId: string, newTitle: string, sessionCwd: string) => {
			try {
				await sessionHistory.updateSessionTitle(
					sessionId,
					newTitle,
					sessionCwd,
				);
				// If the renamed session is open in this tab, update the tab label
				if (
					sessionId === currentSessionIdRef.current &&
					onLabelChangeRef.current
				) {
					onLabelChangeRef.current(newTitle);
				}
				new Notice("[Agent Console] Title updated");
			} catch (error) {
				new Notice("[Agent Console] Failed to update title");
				logger.error("Title update error:", error);
			}
		},
		[sessionHistory.updateSessionTitle, logger],
	);

	const handleLoadMore = useCallback(() => {
		void sessionHistory.loadMoreSessions();
	}, [sessionHistory.loadMoreSessions]);

	const handleFetchSessions = useCallback(
		(cwd?: string) => {
			void sessionHistory.fetchSessions(cwd);
		},
		[sessionHistory.fetchSessions],
	);

	const handleOpenHistory = useCallback(() => {
		// Create modal if it doesn't exist
		if (!historyModalRef.current) {
			historyModalRef.current = new SessionHistoryModal(plugin.app, {
				sessions: sessionHistory.sessions,
				loading: sessionHistory.loading,
				error: sessionHistory.error,
				hasMore: sessionHistory.hasMore,
				currentCwd: vaultPath,
				loadSessionMessages: sessionHistory.loadSessionMessages,
				capabilities: sessionHistory.capabilities,
				localSessionIds: sessionHistory.localSessionIds,
				isAgentReady: isSessionReady,
				debugMode: debugMode,
				onRestoreSession: handleRestoreSession,
				onDeleteSession: handleDeleteSession,
				onEditTitle: handleEditTitle,
				onLoadMore: handleLoadMore,
				onFetchSessions: handleFetchSessions,
			}, () => { historyModalRef.current = null; });
		}
		historyModalRef.current.open();
		void sessionHistory.fetchSessions(vaultPath);
	}, [
		plugin.app,
		sessionHistory.sessions,
		sessionHistory.loading,
		sessionHistory.error,
		sessionHistory.hasMore,
		sessionHistory.capabilities,
		sessionHistory.loadSessionMessages,
		sessionHistory.localSessionIds,
		sessionHistory.fetchSessions,
		vaultPath,
		isSessionReady,
		debugMode,
		handleRestoreSession,
		handleDeleteSession,
		handleEditTitle,
		handleLoadMore,
		handleFetchSessions,
	]);

	// Update modal props when session history state changes
	useEffect(() => {
		if (historyModalRef.current) {
			historyModalRef.current.updateProps({
				sessions: sessionHistory.sessions,
				loading: sessionHistory.loading,
				error: sessionHistory.error,
				hasMore: sessionHistory.hasMore,
				currentCwd: vaultPath,
				loadSessionMessages: sessionHistory.loadSessionMessages,
				capabilities: sessionHistory.capabilities,
				localSessionIds: sessionHistory.localSessionIds,
				isAgentReady: isSessionReady,
				debugMode: debugMode,
				onRestoreSession: handleRestoreSession,
				onDeleteSession: handleDeleteSession,
				onEditTitle: handleEditTitle,
				onLoadMore: handleLoadMore,
				onFetchSessions: handleFetchSessions,
			});
		}
	}, [
		sessionHistory.sessions,
		sessionHistory.loading,
		sessionHistory.error,
		sessionHistory.hasMore,
		sessionHistory.capabilities,
		sessionHistory.loadSessionMessages,
		vaultPath,
		isSessionReady,
		debugMode,
		handleRestoreSession,
		handleDeleteSession,
		handleEditTitle,
		handleLoadMore,
		handleFetchSessions,
	]);

	// RC-4: close the modal if this host (ChatPanel) unmounts while the modal
	// is open. Deleting a session that is open in the owning tab closes that
	// tab, which unmounts the hook driving updateProps — without this the
	// modal is orphaned showing stale content (the just-deleted row). Closing
	// it on unmount lets the user reopen a fresh, correctly-fetched list.
	useEffect(() => {
		return () => {
			historyModalRef.current?.close();
		};
	}, []);

	return { handleOpenHistory, handleDeleteSession };
}
