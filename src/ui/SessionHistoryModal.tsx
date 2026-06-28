/**
 * Session History Modal
 *
 * Contains the Obsidian Modal wrapper, the React content component,
 * and the confirmation modal for session deletion.
 */

import { Modal, App, setIcon } from "obsidian";
import * as React from "react";
const { useState, useCallback } = React;
import { createRoot, Root } from "react-dom/client";
import type { AgentCapabilities, SessionInfo } from "../types/session";
import type { AgentSessionMetaCacheEntry } from "../types/session";
import {
	deriveSessionHistoryView,
	type SessionHistoryView,
	type SessionListSource,
} from "../utils/session-history-view";
import { useSessionSearch } from "../hooks/useSessionSearch";
import type { SearchSnippet } from "../services/session-search";

// ============================================================
// ConfirmDeleteModal (internal)
// ============================================================

/**
 * Confirmation modal for session deletion.
 *
 * Displays session title and asks user to confirm deletion.
 * Calls onConfirm callback only when user clicks Delete button.
 */
class ConfirmDeleteModal extends Modal {
	private sessionTitle: string;
	private onConfirm: () => void | Promise<void>;

	constructor(
		app: App,
		sessionTitle: string,
		onConfirm: () => void | Promise<void>,
	) {
		super(app);
		this.sessionTitle = sessionTitle;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Title
		contentEl.createEl("h2", { text: "Delete session?" });

		// Message
		contentEl.createEl("p", {
			text: `Are you sure you want to delete "${this.sessionTitle}"?`,
			cls: "agent-client-confirm-delete-message",
		});

		contentEl.createEl("p", {
			text: "This only removes the session from this plugin. The session data will remain on the agent side.",
			cls: "agent-client-confirm-delete-warning",
		});

		// Buttons container
		const buttonContainer = contentEl.createDiv({
			cls: "agent-client-confirm-delete-buttons",
		});

		// Cancel button
		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
			cls: "agent-client-confirm-delete-cancel",
		});
		cancelButton.addEventListener("click", () => {
			this.close();
		});

		// Delete button
		const deleteButton = buttonContainer.createEl("button", {
			text: "Delete",
			cls: "agent-client-confirm-delete-confirm mod-warning",
		});
		deleteButton.addEventListener("click", () => {
			this.close();
			void this.onConfirm();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============================================================
// EditTitleModal (internal)
// ============================================================

/**
 * Modal for editing a session title.
 *
 * Displays a text input pre-filled with the current title.
 * Calls onSave callback with the new title when user clicks Save.
 */
export class EditTitleModal extends Modal {
	private currentTitle: string;
	private onSave: (newTitle: string) => void | Promise<void>;

	constructor(
		app: App,
		currentTitle: string,
		onSave: (newTitle: string) => void | Promise<void>,
	) {
		super(app);
		this.currentTitle = currentTitle;
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Edit session title" });

		const inputEl = contentEl.createEl("input", {
			type: "text",
			cls: "agent-client-edit-title-input",
			attr: { maxlength: "100" },
		});
		// createEl sets HTML attribute; explicit assignment sets DOM property (displayed value)
		inputEl.value = this.currentTitle;

		// Focus and select all text for easy replacement
		window.setTimeout(() => {
			inputEl.focus();
			inputEl.select();
		}, 10);

		// Enter key to save
		inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.saveAndClose(inputEl.value);
			}
		});

		const buttonContainer = contentEl.createDiv({
			cls: "agent-client-edit-title-buttons",
		});

		buttonContainer
			.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => {
				this.close();
			});

		buttonContainer
			.createEl("button", {
				text: "Save",
				cls: "mod-cta",
			})
			.addEventListener("click", () => {
				this.saveAndClose(inputEl.value);
			});
	}

	private saveAndClose(rawValue: string) {
		const value = rawValue.trim();
		if (!value) return;
		this.close();
		void this.onSave(value);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============================================================
// SessionHistoryContent (internal)
// ============================================================

/**
 * Props for SessionHistoryContent component.
 */
interface SessionHistoryContentProps {
	/** Obsidian App instance (for creating modals) */
	app: App;
	/** List of sessions to display */
	sessions: SessionInfo[];
	/** Whether sessions are being fetched */
	loading: boolean;
	/** Error message if fetch fails */
	error: string | null;
	/** Whether there are more sessions to load */
	hasMore: boolean;
	/** Current working directory for filtering */
	currentCwd: string;
	/** Loads a session's persisted messages for full-text search indexing. */
	loadSessionMessages: (
		sessionId: string,
	) => Promise<import("../types/chat").ChatMessage[] | null>;

	/**
	 * Normalized agent-capability record (Track B / I117). The whole modal
	 * surface (list source, filters, restore/fork availability, banner) is
	 * derived from this via `deriveSessionHistoryView` — gated on capability
	 * + local-data + intent, never on connection.
	 */
	capabilities: AgentCapabilities;

	/** Set of session IDs that have local data (for filtering) */
	localSessionIds: Set<string>;

	/** Whether the agent is ready (initialized) */
	isAgentReady: boolean;

	/** Whether debug mode is enabled (shows manual input form) */
	debugMode: boolean;

	/**
	 * The persisted Local/Agent toggle choice to start on (Decision 2). The
	 * modal owns the live toggle state from here; `onSourceChange` records
	 * subsequent choices.
	 */
	initialSource: SessionListSource;

	/**
	 * Last-synced server-session metadata for the current tab's agent, or null
	 * if never synced. Powers the disconnected Agent view (Decision 1) — shown
	 * with a "synced N ago — connect to refresh" affordance when the agent is
	 * not connected. Metadata only (no transcripts).
	 */
	agentSessionCache: AgentSessionMetaCacheEntry | null;

	/** agentId → display name, for the per-row agent badge on the Local view. */
	agentLabels: Record<string, string>;

	/**
	 * Display name of the current tab's agent — labels the Agent pill so the
	 * user knows whose server sessions the Agent view shows (D2).
	 */
	currentAgentLabel: string;

	/** Callback when a session is restored */
	onRestoreSession: (sessionId: string, cwd: string) => Promise<void>;
	/** Callback when a session is forked into a new tab */
	onForkSession: (sessionId: string, cwd: string) => Promise<void>;
	/** Callback when a session is deleted */
	onDeleteSession: (sessionId: string) => void | Promise<void>;
	/** Callback when a session title is edited */
	onEditTitle: (
		sessionId: string,
		newTitle: string,
		sessionCwd: string,
	) => void | Promise<void>;
	/** Callback to load more sessions (pagination) */
	onLoadMore: () => void;
	/** Callback to fetch sessions for a source, with an optional cwd filter. */
	onFetchSessions: (source: SessionListSource, cwd?: string) => void;
	/** Persist the Local/Agent toggle choice. */
	onSourceChange: (source: SessionListSource) => void;
	/** Callback to close the modal */
	onClose: () => void;
}

/**
 * Icon button component using Obsidian's setIcon.
 */
function IconButton({
	iconName,
	label,
	className,
	onClick,
}: {
	iconName: string;
	label: string;
	className: string;
	onClick: () => void;
}) {
	const iconRef = React.useRef<HTMLButtonElement>(null);

	React.useEffect(() => {
		if (iconRef.current) {
			setIcon(iconRef.current, iconName);
		}
	}, [iconName]);

	return (
		<button
			ref={iconRef}
			type="button"
			className={`clickable-icon ${className}`}
			aria-label={label}
			onClick={onClick}
		/>
	);
}

/**
 * Format timestamp as relative time.
 * Examples: "2 hours ago", "yesterday", "3 days ago"
 */
function formatRelativeTime(date: Date): string {
	const now = Date.now();
	const timestamp = date.getTime();
	const diffMs = now - timestamp;
	const diffSeconds = Math.floor(diffMs / 1000);
	const diffMinutes = Math.floor(diffSeconds / 60);
	const diffHours = Math.floor(diffMinutes / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffMinutes < 1) {
		return "just now";
	} else if (diffMinutes < 60) {
		return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
	} else if (diffHours < 24) {
		return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
	} else if (diffDays === 1) {
		return "yesterday";
	} else if (diffDays < 7) {
		return `${diffDays} days ago`;
	} else {
		const month = date.toLocaleString("default", { month: "short" });
		const day = date.getDate();
		const year = date.getFullYear();
		return `${month} ${day}, ${year}`;
	}
}

/**
 * Truncate session title to 50 characters with ellipsis.
 */
function truncateTitle(title: string): string {
	if (title.length <= 50) {
		return title;
	}
	return title.slice(0, 50) + "...";
}

/**
 * Debug form for manual session input.
 */
function DebugForm({
	currentCwd,
	onRestoreSession,
	onClose,
}: {
	currentCwd: string;
	onRestoreSession: (sessionId: string, cwd: string) => Promise<void>;
	onClose: () => void;
}) {
	const [sessionId, setSessionId] = useState("");
	const [cwd, setCwd] = useState(currentCwd);

	const handleRestore = useCallback(() => {
		if (sessionId.trim()) {
			onClose();
			void onRestoreSession(sessionId.trim(), cwd.trim() || currentCwd);
		}
	}, [sessionId, cwd, currentCwd, onRestoreSession, onClose]);

	return (
		<div className="agent-client-session-history-debug">
			<h3>Debug: Manual Session Input</h3>

			<div className="agent-client-session-history-debug-group">
				<label htmlFor="debug-session-id">Session ID:</label>
				<input
					id="debug-session-id"
					type="text"
					placeholder="Enter session ID..."
					className="agent-client-session-history-debug-input"
					value={sessionId}
					onChange={(e) => setSessionId(e.target.value)}
				/>
			</div>

			<div className="agent-client-session-history-debug-group">
				<label htmlFor="debug-cwd">Working Directory (cwd):</label>
				<input
					id="debug-cwd"
					type="text"
					placeholder="Enter working directory..."
					className="agent-client-session-history-debug-input"
					value={cwd}
					onChange={(e) => setCwd(e.target.value)}
				/>
			</div>

			<div className="agent-client-session-history-debug-actions">
				<button
					className="agent-client-session-history-debug-button"
					onClick={handleRestore}
				>
					Restore
				</button>
			</div>

			<hr className="agent-client-session-history-debug-separator" />
		</div>
	);
}

/**
 * Render text with all case-insensitive occurrences of `query` wrapped in
 * <mark> for highlighting. Empty query → plain text.
 */
function HighlightedText({
	text,
	query,
}: {
	text: string;
	query: string;
}) {
	const q = query.trim();
	if (!q) return <>{text}</>;
	const lower = text.toLowerCase();
	const qLower = q.toLowerCase();
	const parts: React.ReactNode[] = [];
	let i = 0;
	let key = 0;
	while (i < text.length) {
		const idx = lower.indexOf(qLower, i);
		if (idx === -1) {
			parts.push(text.slice(i));
			break;
		}
		if (idx > i) parts.push(text.slice(i, idx));
		parts.push(
			<mark
				key={key++}
				className="agent-client-session-history-match"
			>
				{text.slice(idx, idx + q.length)}
			</mark>,
		);
		i = idx + q.length;
	}
	return <>{parts}</>;
}

/**
 * Session list item component.
 */
function SessionItem({
	session,
	snippet,
	query,
	canRestore,
	canFork,
	agentLabel,
	currentCwd,
	onRestoreSession,
	onForkSession,
	onDeleteSession,
	onEditTitle,
	onClose,
}: {
	session: SessionInfo;
	snippet?: SearchSnippet;
	query: string;
	canRestore: boolean;
	canFork: boolean;
	agentLabel?: string;
	currentCwd: string;
	onRestoreSession: (sessionId: string, cwd: string) => Promise<void>;
	onForkSession: (sessionId: string, cwd: string) => Promise<void>;
	onDeleteSession: (sessionId: string) => void | Promise<void>;
	onEditTitle: (sessionId: string) => void;
	onClose: () => void;
}) {
	const handleRestore = useCallback(() => {
		onClose();
		void onRestoreSession(session.sessionId, session.cwd);
	}, [session, onRestoreSession, onClose]);

	const handleFork = useCallback(() => {
		onClose();
		void onForkSession(session.sessionId, session.cwd);
	}, [session, onForkSession, onClose]);


	const handleDelete = useCallback(() => {
		void onDeleteSession(session.sessionId);
	}, [session.sessionId, onDeleteSession]);

	const handleEditTitle = useCallback(() => {
		onEditTitle(session.sessionId);
	}, [session.sessionId, onEditTitle]);

	return (
		<div className="agent-client-session-history-item">
			<div className="agent-client-session-history-item-content">
				<div className="agent-client-session-history-item-title">
					<span>
						<HighlightedText
							text={truncateTitle(
								session.title ?? "Untitled Session",
							)}
							query={query}
						/>
					</span>
				</div>
				<div className="agent-client-session-history-item-metadata">
					{agentLabel && (
						<span
							className="agent-client-session-history-item-agent-badge"
							aria-label={`Agent: ${agentLabel}`}
						>
							{agentLabel}
						</span>
					)}
					{session.updatedAt && (
						<span className="agent-client-session-history-item-timestamp">
							{formatRelativeTime(new Date(session.updatedAt))}
						</span>
					)}
					{session.cwd !== currentCwd && (
						<span
							className="agent-client-session-history-item-cwd"
							aria-label={session.cwd}
						>
							{session.cwd}
						</span>
					)}
				</div>
				{snippet && (
					<div className="agent-client-session-history-item-snippet">
						{snippet.text.slice(0, snippet.matchStart)}
						<mark className="agent-client-session-history-item-snippet-match">
							{snippet.text.slice(
								snippet.matchStart,
								snippet.matchStart + snippet.matchLength,
							)}
						</mark>
						{snippet.text.slice(
							snippet.matchStart + snippet.matchLength,
						)}
					</div>
				)}
			</div>

			<div className="agent-client-session-history-item-actions">
				<IconButton
					iconName="pencil"
					label="Edit session title"
					className="agent-client-session-history-action-icon agent-client-session-history-edit-icon"
					onClick={handleEditTitle}
				/>
				{canRestore && (
					<IconButton
						iconName="play"
						label="Restore session"
						className="agent-client-session-history-action-icon agent-client-session-history-restore-icon"
						onClick={handleRestore}
					/>
				)}
				{canFork && (
					<IconButton
						iconName="git-branch"
						label="Fork session into a new tab"
						className="agent-client-session-history-action-icon agent-client-session-history-fork-icon"
						onClick={handleFork}
					/>
				)}
				<IconButton
					iconName="trash-2"
					label="Delete session"
					className="agent-client-session-history-action-icon agent-client-session-history-delete-icon"
					onClick={handleDelete}
				/>
			</div>
		</div>
	);
}

/**
 * Session history content component.
 *
 * Renders the content of the session history modal including:
 * - Debug form (when debug mode enabled)
 * - Local sessions banner
 * - Filter toggle (for agent session/list)
 * - Session list with load/resume/fork actions
 * - Pagination
 */
export function SessionHistoryContent({
	app,
	sessions,
	loading,
	error,
	hasMore,
	currentCwd,
	loadSessionMessages,
	capabilities,
	localSessionIds,
	isAgentReady,
	debugMode,
	initialSource,
	agentSessionCache,
	agentLabels,
	currentAgentLabel,
	onRestoreSession,
	onForkSession,
	onDeleteSession,
	onEditTitle,
	onLoadMore,
	onFetchSessions,
	onSourceChange,
	onClose,
}: SessionHistoryContentProps) {
	// The Local/Agent toggle choice (Decision 2 — seeded from the persisted
	// last choice). Drives the resolver's source input and the fetch.
	const [source, setSource] = useState<SessionListSource>(initialSource);
	// The "This vault only" cwd filter — Agent view only.
	const [filterByCurrentVault, setFilterByCurrentVault] = useState(true);

	// Full-text search over the local session library (titles + content).
	const {
		query,
		setQuery,
		results: searchResults,
		indexState,
		ensureIndex,
		invalidate: invalidateSearch,
	} = useSessionSearch({ sessions, loadSessionMessages });

	const sessionById = React.useMemo(
		() => new Map(sessions.map((s) => [s.sessionId, s])),
		[sessions],
	);

	// One pure decision for the whole modal surface (Track C —
	// deriveSessionHistoryView). Gated on capability + local-data + intent,
	// NOT on connection: supersedes the I09 "Connect to an agent…" gate and
	// the I41 "does not support restoration" banner. `isAgentReady` is passed
	// for completeness but the resolver provably ignores it (connection
	// invariance), so restore/fork show on a not-yet-connected tab and the
	// orchestration reconnects lazily.
	const hasLocalData = localSessionIds.size > 0;
	const view: SessionHistoryView = deriveSessionHistoryView(
		capabilities,
		isAgentReady,
		hasLocalData,
		source,
	);

	// Agent view served from the local metadata cache while the agent is NOT
	// connected (Decision 1, "Connection-free reading" tenet). The live
	// session/list needs a connection; when there isn't one we render the
	// last-synced rows with a freshness affordance instead of forcing a
	// connect. Metadata only — no transcript search over these rows.
	const agentViewDisconnected =
		view.listSource === "agent" && !isAgentReady;

	// I94: focus the search box when the modal opens so the user can type
	// immediately. Index build is NOT triggered here — it fires on first
	// keystroke (below), keeping the open path cheap and avoiding a hint flash.
	const searchInputRef = React.useRef<HTMLInputElement>(null);
	React.useEffect(() => {
		searchInputRef.current?.focus();
	}, []);

	// I95: only surface the "Searching transcripts…" hint if the build runs
	// long enough to matter (>250ms). Fast builds (small libraries) never
	// flash it.
	const [showBuildingHint, setShowBuildingHint] = useState(false);
	React.useEffect(() => {
		if (indexState !== "building") {
			setShowBuildingHint(false);
			return;
		}
		const handle = window.setTimeout(
			() => setShowBuildingHint(true),
			250,
		);
		return () => window.clearTimeout(handle);
	}, [indexState]);

	// Switch between the Local store and the agent's server list. Persists the
	// choice (Decision 2) and refetches. The cwd filter applies to Agent only.
	const handleSourceToggle = useCallback(
		(next: SessionListSource) => {
			if (next === source) return;
			setSource(next);
			onSourceChange(next);
			onFetchSessions(
				next,
				next === "agent" && filterByCurrentVault
					? currentCwd
					: undefined,
			);
		},
		[source, onSourceChange, onFetchSessions, filterByCurrentVault, currentCwd],
	);

	const handleFilterChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const checked = e.target.checked;
			setFilterByCurrentVault(checked);
			// The filter is Agent-view only.
			onFetchSessions("agent", checked ? currentCwd : undefined);
		},
		[currentCwd, onFetchSessions],
	);

	const handleRetry = useCallback(() => {
		onFetchSessions(
			source,
			source === "agent" && filterByCurrentVault ? currentCwd : undefined,
		);
	}, [source, filterByCurrentVault, currentCwd, onFetchSessions]);

	// Wrap onDeleteSession to show confirmation modal
	const handleDeleteWithConfirmation = useCallback(
		(sessionId: string) => {
			const targetSession = sessions.find(
				(s) => s.sessionId === sessionId,
			);
			const sessionTitle = targetSession?.title ?? "Untitled Session";

			const confirmModal = new ConfirmDeleteModal(
				app,
				sessionTitle,
				() => {
					void onDeleteSession(sessionId);
					invalidateSearch(sessionId);
				},
			);
			confirmModal.open();
		},
		[app, sessions, onDeleteSession, invalidateSearch],
	);

	// Open edit title modal for a session
	const handleEditWithModal = useCallback(
		(sessionId: string) => {
			const targetSession = sessions.find(
				(s) => s.sessionId === sessionId,
			);
			const currentTitle = targetSession?.title ?? "Untitled Session";
			const sessionCwd = targetSession?.cwd ?? currentCwd;

			const modal = new EditTitleModal(app, currentTitle, (newTitle) => {
				void onEditTitle(sessionId, newTitle, sessionCwd);
			});
			modal.open();
		},
		[app, sessions, currentCwd, onEditTitle],
	);

	// Display list. Connected/local → search results over the indexed local
	// sessions. Disconnected Agent view → the last-synced metadata cache,
	// title-filtered by the query (no transcript search — the cache is
	// metadata only).
	const displayItems = React.useMemo(() => {
		if (agentViewDisconnected) {
			const q = query.trim().toLowerCase();
			const rows = agentSessionCache?.sessions ?? [];
			const filtered = q
				? rows.filter((s) =>
						(s.title ?? "").toLowerCase().includes(q),
					)
				: rows;
			return filtered.map((s) => ({
				session: s,
				snippet: undefined as SearchSnippet | undefined,
			}));
		}
		const items: { session: SessionInfo; snippet?: SearchSnippet }[] = [];
		for (const match of searchResults) {
			const s = sessionById.get(match.sessionId);
			if (!s) continue;
			items.push({ session: s, snippet: match.snippet });
		}
		return items;
	}, [
		agentViewDisconnected,
		agentSessionCache,
		query,
		searchResults,
		sessionById,
	]);

	return (
		<>
			{/* Debug form */}
			{debugMode && (
				<DebugForm
					currentCwd={currentCwd}
					onRestoreSession={onRestoreSession}
					onClose={onClose}
				/>
			)}

			{/* Banner — derived from the resolver. There is no connection-gated
			    "Connect to an agent…" message (I09 superseded); the "no
			    restoration" warning shows only when restore is genuinely
			    impossible (I41 superseded — suppressed whenever local data
			    exists). */}
			{view.banner === "no-restore-capability" && (
				<div className="agent-client-session-history-warning-banner">
					<p>This agent does not support restoring sessions.</p>
				</div>
			)}

			{/* The "local-saved" banner was removed: the explicit [Local] pill
			    now conveys the source, so the extra line was redundant and
			    added vertical churn when toggling (D4). */}

			{(
				<>
					{/* Local / Agent source toggle — replaces the old filter
					    checkboxes. Always shown for consistency/transparency:
					    the Agent pill is named after the tab's agent (D2) and
					    is disabled with a tooltip when that agent can't list
					    server sessions (D3 — e.g. Kiro CLI), rather than
					    silently vanishing. Native buttons for keyboard
					    activation + focus ring (Keyboard-first tenet). */}
					<div
						className="agent-client-session-history-source-toggle"
						role="tablist"
						aria-label="Session source"
					>
						<button
							type="button"
							role="tab"
							aria-selected={view.listSource === "local"}
							className={`agent-client-session-history-source-pill${
								view.listSource === "local" ? " is-active" : ""
							}`}
							onClick={() => handleSourceToggle("local")}
						>
							Local
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={view.listSource === "agent"}
							aria-label={`Agent server sessions (${currentAgentLabel})`}
							disabled={!view.agentViewAvailable}
							title={
								view.agentViewAvailable
									? undefined
									: `${currentAgentLabel} doesn't keep a session list on its server, so only your local history is available.`
							}
							className={`agent-client-session-history-source-pill${
								view.listSource === "agent" ? " is-active" : ""
							}`}
							onClick={() => handleSourceToggle("agent")}
						>
							{currentAgentLabel}
						</button>
					</div>

					{/* Disconnected Agent view — served from the last-synced
					    metadata cache with a freshness affordance instead of
					    forcing a connect (Decision 1). */}
					{agentViewDisconnected && (
						<div className="agent-client-session-history-sync-affordance">
							{agentSessionCache ? (
								<span>
									Synced{" "}
									{formatRelativeTime(
										new Date(agentSessionCache.syncedAt),
									)}{" "}
									– send a message to reconnect and refresh
								</span>
							) : (
								<span>
									Send a message to connect, then this list
									loads from the agent
								</span>
							)}
						</div>
					)}

					{/* Full-text search */}
					<div className="agent-client-session-history-search">
						<input
							ref={searchInputRef}
							type="text"
							className="agent-client-session-history-search-input"
							placeholder="Search sessions…"
							value={query}
							aria-label="Search sessions"
							onChange={(e) => {
								ensureIndex();
								setQuery(e.target.value);
							}}
						/>
						{showBuildingHint && (
							<span className="agent-client-session-history-search-status">
								Searching transcripts…
							</span>
						)}
					</div>

					{/* "This vault only" — Agent view only (the cwd filter).
					    Local spans every vault, so it carries no filter. */}
					{view.showFilters && (
						<div className="agent-client-session-history-filter">
							<label
								className="agent-client-session-history-filter-label"
								title="Only show the agent's sessions whose working folder is this vault."
							>
								<input
									type="checkbox"
									checked={filterByCurrentVault}
									onChange={handleFilterChange}
								/>
								<span>This vault only</span>
							</label>
						</div>
					)}

					{/* Error state */}
					{error && (
						<div className="agent-client-session-history-error">
							<p className="agent-client-session-history-error-text">
								{error}
							</p>
							<button
								className="agent-client-session-history-retry-button"
								onClick={handleRetry}
							>
								Retry
							</button>
						</div>
					)}

					{/* Loading state */}
					{!error && loading && displayItems.length === 0 && (
						<div className="agent-client-session-history-loading">
							<p>Loading sessions...</p>
						</div>
					)}

					{/* Empty state */}
					{!error && !loading && displayItems.length === 0 && (
						<div className="agent-client-session-history-empty">
							{!query.trim() &&
							view.listSource === "local" &&
							view.agentViewAvailable ? (
								// Migration empty-state: the local store is
								// empty but the agent can list server-side
								// sessions (e.g. arriving from Agent Client,
								// whose local store isn't inherited). Point the
								// user to the Agent view instead of a bare
								// "none".
								<>
									<p className="agent-client-session-history-empty-text">
										{agentSessionCache &&
										agentSessionCache.sessions.length > 0
											? `No local sessions yet. Your agent has ${agentSessionCache.sessions.length} — view them under Agent.`
											: "No local sessions yet. Your agent may have saved sessions — view them under Agent."}
									</p>
									<button
										type="button"
										className="agent-client-session-history-empty-action"
										onClick={() =>
											handleSourceToggle("agent")
										}
									>
										View agent sessions
									</button>
								</>
							) : (
								<p className="agent-client-session-history-empty-text">
									{query.trim()
										? "No sessions match your search"
										: "No previous sessions"}
								</p>
							)}
						</div>
					)}

					{/* Session list */}
					{!error && displayItems.length > 0 && (
						<div className="agent-client-session-history-list">
							{displayItems.map(({ session, snippet }) => (
								<SessionItem
									key={session.sessionId}
									session={session}
									snippet={snippet}
									query={query}
									canRestore={view.restore !== "hidden"}
									canFork={view.fork === "available"}
									agentLabel={
										session.agentId
											? agentLabels[session.agentId]
											: undefined
									}
									currentCwd={currentCwd}
									onRestoreSession={onRestoreSession}
									onForkSession={onForkSession}
									onDeleteSession={
										handleDeleteWithConfirmation
									}
									onEditTitle={handleEditWithModal}
									onClose={onClose}
								/>
							))}
						</div>
					)}

					{/* Load more button */}
					{!error && hasMore && (
						<div className="agent-client-session-history-load-more">
							<button
								className="agent-client-session-history-load-more-button"
								disabled={loading}
								onClick={onLoadMore}
							>
								{loading ? "Loading..." : "Load more"}
							</button>
						</div>
					)}
				</>
			)}
		</>
	);
}

// ============================================================
// SessionHistoryModal (exported)
// ============================================================

/**
 * Props for SessionHistoryModal (same as SessionHistoryContentProps minus onClose and app).
 */
export type SessionHistoryModalProps = Omit<
	SessionHistoryContentProps,
	"onClose" | "app"
>;

/**
 * Modal for displaying and selecting from session history.
 *
 * This is a thin wrapper around the SessionHistoryContent React component.
 * It extends Obsidian's Modal class for proper modal behavior (backdrop,
 * escape key handling, etc.) while delegating all UI rendering to React.
 */
export class SessionHistoryModal extends Modal {
	private root: Root | null = null;
	private props: SessionHistoryModalProps;
	private onModalClose?: () => void;

	constructor(app: App, props: SessionHistoryModalProps, onModalClose?: () => void) {
		super(app);
		this.props = props;
		this.onModalClose = onModalClose;
	}

	/**
	 * Update modal props and re-render the React component.
	 * Call this when session data changes.
	 */
	updateProps(props: SessionHistoryModalProps) {
		this.props = props;
		this.renderContent();
	}

	/**
	 * Called when modal is opened.
	 * Creates React root and renders the content.
	 */
	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		// Stable-size class so the frame doesn't resize/re-center as search
		// filters the result count (I96).
		this.modalEl.addClass("agent-client-session-history-modal");

		// Add modal title
		contentEl.createEl("h2", { text: "Session history" });

		// Create container for React content
		const reactContainer = contentEl.createDiv();

		// Create React root and render
		this.root = createRoot(reactContainer);
		this.renderContent();
	}

	/**
	 * Render or re-render the React content.
	 */
	private renderContent() {
		if (this.root) {
			this.root.render(
				React.createElement(SessionHistoryContent, {
					...this.props,
					app: this.app,
					onClose: () => this.close(),
				}),
			);
		}
	}

	/**
	 * Called when modal is closed.
	 * Unmounts React component and cleans up.
	 */
	onClose() {
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
		const { contentEl } = this;
		contentEl.empty();
		this.onModalClose?.();
	}
}
