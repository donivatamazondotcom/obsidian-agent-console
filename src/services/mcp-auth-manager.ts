import { Notice } from "obsidian";

import type {
	KiroMcpServerStatus,
	McpAuthEvent,
	PendingMcpAuth,
} from "../types/mcp-auth";
import { reduceMcpStatusSnapshot } from "../acp/kiro-v3";
import { getLogger } from "../utils/logger";
import { t } from "../i18n";

/**
 * Single owner of pending MCP sign-in state (per the single-writer rule).
 *
 * Subscribes to each AcpClient's McpAuthEvent channel. Tracks which MCP
 * servers are waiting for the user to complete OAuth sign-in, and owns the
 * one queue-aware Notice that surfaces them.
 *
 * UX contract (see MCP OAuth Prompt Surfacing spec):
 * - Never auto-open the browser. Sign-in is always a user click.
 * - One persistent Notice for the whole queue, not a stack.
 * - Silent dismissal on success — no "connected" confirmation popup.
 * - Pending state survives Notice dismissal (the command re-lists it).
 *
 * Kiro CLI V3 (S4) adds `_kiro/mcp/status` snapshots: an auth failure is a
 * pending sign-in with no URL yet, and Sign in asks the server for one via
 * resetServer. The URL that comes back (`_kiro/openExternalUrl`) opens at once
 * only when it follows the user's click; otherwise it waits for a click.
 */

// ============================================================================
// Pure state core (exported for tests)
// ============================================================================

type PendingEntry = PendingMcpAuth & {
	viewId: string;
	/** Created from a V3 status snapshot; its lifecycle follows the snapshots. */
	fromStatus?: boolean;
};

export interface McpAuthState {
	/** Insertion-ordered pending sign-ins, keyed by `viewId\u0000serverName`. */
	pending: Map<string, PendingEntry>;
	/** V3: the latest MCP status per view, by server name. */
	status: Map<string, Map<string, KiroMcpServerStatus>>;
	/** V3: servers that reported a sign-in failure in this view. */
	authSeen: Map<string, Set<string>>;
}

export function createMcpAuthState(): McpAuthState {
	return { pending: new Map(), status: new Map(), authSeen: new Map() };
}

/** Label for a sign-in URL that names no server and matches no pending one. */
const UNNAMED_SERVER = "MCP server";

function entryKey(viewId: string, serverName: string): string {
	return `${viewId}\u0000${serverName}`;
}

/** Extract the hostname for informed consent; empty string if unparsable. */
export function oauthUrlHost(oauthUrl: string): string {
	try {
		return new URL(oauthUrl).hostname;
	} catch {
		return "";
	}
}

/**
 * Apply an auth event to the state. Returns true when state changed.
 * Total: unknown combinations are no-ops, never throws.
 */
export function reduceMcpAuth(
	state: McpAuthState,
	viewId: string,
	event: McpAuthEvent,
	now: number,
): boolean {
	switch (event.kind) {
		case "oauth_request": {
			const key = entryKey(viewId, event.serverName);
			state.pending.set(key, {
				viewId,
				serverName: event.serverName,
				oauthUrl: event.oauthUrl,
				host: oauthUrlHost(event.oauthUrl),
				receivedAt: now,
			});
			return true;
		}
		case "server_initialized": {
			return state.pending.delete(entryKey(viewId, event.serverName));
		}
		case "status_snapshot": {
			return applyStatusSnapshot(state, viewId, event.servers, now);
		}
		case "open_external_url": {
			return attachSignInUrl(state, viewId, event.url, event.serverName, now);
		}
	}
}

function applyStatusSnapshot(
	state: McpAuthState,
	viewId: string,
	servers: KiroMcpServerStatus[],
	now: number,
): boolean {
	const prev = state.status.get(viewId) ?? new Map<string, KiroMcpServerStatus>();
	const { next, changed } = reduceMcpStatusSnapshot(prev, servers);
	if (!changed) return false;
	state.status.set(viewId, next);

	for (const server of next.values()) {
		if (server.status !== "failed" || !server.failedAuthorization) continue;
		let seen = state.authSeen.get(viewId);
		if (!seen) state.authSeen.set(viewId, (seen = new Set()));
		seen.add(server.name);
		const key = entryKey(viewId, server.name);
		if (!state.pending.has(key)) {
			state.pending.set(key, {
				viewId,
				serverName: server.name,
				host: "",
				receivedAt: now,
				fromStatus: true,
			});
		}
	}
	// A snapshot-born sign-in ends when the server connects, is disabled,
	// leaves the snapshot, or fails for another reason. While `connecting`
	// (the user's sign-in is in progress) it stays.
	for (const [key, entry] of state.pending) {
		if (entry.viewId !== viewId || !entry.fromStatus) continue;
		const server = next.get(entry.serverName);
		const stillWaiting =
			server !== undefined &&
			(server.status === "connecting" ||
				(server.status === "failed" && server.failedAuthorization));
		if (!stillWaiting) state.pending.delete(key);
	}
	return true;
}

/** An unsolicited V3 sign-in URL: attach it to its pending entry, or add one. */
export function attachSignInUrl(
	state: McpAuthState,
	viewId: string,
	url: string,
	serverName: string | undefined,
	now: number,
): boolean {
	const inView = [...state.pending.values()].filter((e) => e.viewId === viewId);
	const target =
		(serverName !== undefined
			? inView.find((e) => e.serverName === serverName)
			: undefined) ?? (inView.length === 1 ? inView[0] : undefined);
	// V3 sends the URL with no server name. When no pending entry matches,
	// use the one server in this view that needed sign-in and is still
	// signing in or failed.
	const fromStatus =
		target === undefined && serverName === undefined
			? signingInServer(state, viewId)
			: undefined;
	const name = target?.serverName ?? serverName ?? fromStatus ?? UNNAMED_SERVER;
	state.pending.set(entryKey(viewId, name), {
		viewId,
		serverName: name,
		host: oauthUrlHost(url),
		receivedAt: target?.receivedAt ?? now,
		...((target?.fromStatus || fromStatus !== undefined) && { fromStatus: true }),
		oauthUrl: url,
	});
	return true;
}

function signingInServer(state: McpAuthState, viewId: string): string | undefined {
	const seen = state.authSeen.get(viewId);
	const status = state.status.get(viewId);
	if (!seen || !status) return undefined;
	const candidates = [...seen].filter((name) => {
		const s = status.get(name);
		return s !== undefined && (s.status === "connecting" || s.status === "failed");
	});
	return candidates.length === 1 ? candidates[0] : undefined;
}

/** A server that failed to connect for a reason other than sign-in. */
export interface McpServerFailure {
	serverName: string;
	message?: string;
}

/** How long after a Sign in click the server's URL may open by itself. */
export const SIGN_IN_OPEN_WINDOW_MS = 2 * 60 * 1000;

// ============================================================================
// Manager (Notice lifecycle + subscriptions)
// ============================================================================

export class McpAuthManager {
	private state = createMcpAuthState();
	/** V3: per-view resetServer callers, from `trackClient`. */
	private resetters = new Map<string, (serverName: string) => Promise<void>>();
	/**
	 * V3: the latest Sign in click per view. Each click is its own attempt,
	 * so an earlier attempt ending can't clear a newer one.
	 */
	private signInAttempts = new Map<
		string,
		{
			id: number;
			serverName: string;
			at: number;
			pageOpened: boolean;
			/** The page Kiro sent for this attempt. Kept in memory only. */
			url?: string;
		}
	>();
	private nextAttemptId = 1;
	/** V3: signature of the failure list the user dismissed, per view. */
	private dismissedFailures = new Map<string, string>();
	private notice: Notice | null = null;
	private changeListeners = new Set<() => void>();
	private logger = getLogger();

	/**
	 * Subscribe a client's auth events under a view id.
	 * Returns the unsubscribe function (call on view close).
	 */
	trackClient(
		viewId: string,
		client: {
			onMcpAuthEvent: (cb: (event: McpAuthEvent) => void) => () => void;
			/** V3: start a fresh sign-in for a server (resetServer). */
			resetMcpServer?: (serverName: string) => Promise<void>;
		},
	): () => void {
		const unsubscribe = client.onMcpAuthEvent((event) => {
			this.handleEvent(viewId, event);
		});
		if (client.resetMcpServer) {
			this.resetters.set(viewId, (name) => client.resetMcpServer!(name));
		}
		return () => {
			unsubscribe();
			this.resetters.delete(viewId);
			this.signInAttempts.delete(viewId);
			this.dismissedFailures.delete(viewId);
			this.dropView(viewId);
		};
	}

	/**
	 * V3: servers in this view that failed for a reason other than sign-in,
	 * in snapshot order. Empty once the user dismissed this exact set.
	 */
	getFailures(viewId: string): McpServerFailure[] {
		const status = this.state.status.get(viewId);
		if (!status) return [];
		const failures: McpServerFailure[] = [];
		for (const s of status.values()) {
			if (s.status === "failed" && !s.failedAuthorization) {
				failures.push({
					serverName: s.name,
					...(s.errorMessage !== undefined && { message: s.errorMessage }),
				});
			}
		}
		if (failures.length === 0) return [];
		if (this.dismissedFailures.get(viewId) === failureSignature(failures)) return [];
		return failures;
	}

	/** Hide the current failure list for a view until the set changes. */
	dismissFailures(viewId: string): void {
		const failures = this.getFailures(viewId);
		if (failures.length === 0) return;
		this.dismissedFailures.set(viewId, failureSignature(failures));
		this.emitChange();
	}

	/** Pending sign-ins, oldest first, deduplicated by server name. */
	getPending(): PendingMcpAuth[] {
		const byServer = new Map<string, PendingMcpAuth>();
		for (const entry of this.state.pending.values()) {
			if (!byServer.has(entry.serverName)) {
				byServer.set(entry.serverName, entry);
			}
		}
		return [...byServer.values()];
	}

	/** Pending sign-in for a specific server name, if any. */
	getPendingForServer(serverName: string): PendingMcpAuth | undefined {
		return this.getPending().find((p) => p.serverName === serverName);
	}

	/** Subscribe to pending-state changes (for React consumers). */
	onChange(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	/**
	 * Sign in for a pending entry. User-initiated only. With a URL, opens it.
	 * Without one (V3), asks the server for a fresh sign-in; the page it
	 * sends back opens because it follows this click.
	 */
	openSignIn(entry: PendingMcpAuth): void {
		const internal = this.findEntry(entry.serverName);
		// V3 entries always ask the server for a fresh page: a page it sent
		// earlier may belong to an attempt that already ended.
		if (!internal?.fromStatus || internal.signInUnavailable) {
			if (entry.oauthUrl) window.open(entry.oauthUrl);
			return;
		}
		const reset = this.resetters.get(internal.viewId);
		if (!reset) {
			this.markSignInUnavailable(internal);
			return;
		}
		const viewId = internal.viewId;
		// Kiro runs one sign-in per server at a time: a second reset waits
		// for the first to time out (~60 s, live 2026-10-27). While an
		// attempt is still open, reopen its page instead of starting another.
		const live = this.signInAttempts.get(viewId);
		if (live && live.serverName === internal.serverName) {
			if (live.url) window.open(live.url);
			return;
		}
		const attempt: {
			id: number;
			serverName: string;
			at: number;
			pageOpened: boolean;
			url?: string;
		} = {
			id: this.nextAttemptId++,
			serverName: internal.serverName,
			at: Date.now(),
			pageOpened: false,
		};
		this.signInAttempts.set(viewId, attempt);
		// The server answers resetServer only when the sign-in ends (verified
		// live 2026-10-27), so a rejection after the page opened means the
		// user abandoned or failed that sign-in, not that in-app sign-in is
		// impossible. Only a rejection before any page arrived falls back.
		// A rejection from an attempt the user already replaced is ignored.
		const settle = () => {
			if (this.signInAttempts.get(viewId)?.id === attempt.id) {
				this.signInAttempts.delete(viewId);
			}
		};
		reset(internal.serverName).then(settle, () => {
			if (this.signInAttempts.get(viewId)?.id !== attempt.id) return;
			this.signInAttempts.delete(viewId);
			if (attempt.pageOpened) {
				this.logger.warn(`MCP sign-in for "${internal.serverName}" did not complete`);
				return;
			}
			this.logger.warn(`MCP sign-in could not start for "${internal.serverName}"`);
			this.markSignInUnavailable(internal);
		});
	}

	/** Copy the sign-in link. User-initiated only. */
	async copySignInLink(entry: PendingMcpAuth): Promise<void> {
		if (!entry.oauthUrl) return;
		await navigator.clipboard.writeText(entry.oauthUrl);
		new Notice(t("notices.mcpSignInLinkCopied", { server: entry.serverName }));
	}

	/** Tear down the Notice and subscriptions (plugin unload). */
	destroy(): void {
		this.hideNotice();
		this.changeListeners.clear();
		this.state = createMcpAuthState();
	}

	// ------------------------------------------------------------------
	// Internals
	// ------------------------------------------------------------------

	private handleEvent(viewId: string, event: McpAuthEvent): void {
		if (event.kind === "open_external_url") {
			const attempt = this.signInAttempts.get(viewId);
			if (attempt && Date.now() - attempt.at <= SIGN_IN_OPEN_WINDOW_MS) {
				// The first page opens; a later one in the same attempt (Kiro
				// retrying inside it) only replaces the page Sign in reopens.
				attempt.url = event.url;
				if (!attempt.pageOpened) {
					attempt.pageOpened = true;
					window.open(event.url);
				}
				return;
			}
		}
		const before = this.pendingSignature();
		const changed = reduceMcpAuth(this.state, viewId, event, Date.now());
		if (!changed) return;
		// Rebuild the corner notice only when what it shows changed. Obsidian
		// fades a hidden Notice out, so rebuilding on every snapshot stacked
		// copies (S4 smoke check 1).
		if (this.pendingSignature() !== before) this.refreshNotice();
		this.emitChange();
	}

	private pendingSignature(): string {
		return this.getPending()
			.map((p) => `${p.serverName}\u0000${p.host}\u0000${p.oauthUrl ? 1 : 0}\u0000${p.signInUnavailable ? 1 : 0}`)
			.join("\u0001");
	}

	private findEntry(serverName: string): PendingEntry | undefined {
		for (const entry of this.state.pending.values()) {
			if (entry.serverName === serverName) return entry;
		}
		return undefined;
	}

	private markSignInUnavailable(entry: PendingEntry): void {
		entry.signInUnavailable = true;
		this.refreshNotice();
		this.emitChange();
	}

	/** Remove all pending entries for a closed view. */
	private dropView(viewId: string): void {
		this.state.authSeen.delete(viewId);
		let changed = this.state.status.delete(viewId);
		for (const [key, entry] of this.state.pending) {
			if (entry.viewId === viewId) {
				this.state.pending.delete(key);
				changed = true;
			}
		}
		if (changed) {
			this.refreshNotice();
			this.emitChange();
		}
	}

	private emitChange(): void {
		for (const listener of this.changeListeners) {
			listener();
		}
	}

	/**
	 * One queue-aware Notice for the whole pending set. Re-rendered on every
	 * state change; hidden when the queue empties (silent success).
	 */
	private refreshNotice(): void {
		this.hideNotice();
		const pending = this.getPending();
		if (pending.length === 0) return;

		const [first, ...rest] = pending;
		const fragment = this.buildNoticeFragment(first, rest);
		// duration 0 = stays until dismissed or the queue empties.
		this.notice = new Notice(fragment, 0);
	}

	private hideNotice(): void {
		if (this.notice) {
			this.notice.hide();
			this.notice = null;
		}
	}

	private buildNoticeFragment(
		entry: PendingMcpAuth,
		queued: PendingMcpAuth[],
	): DocumentFragment {
		const root = createDiv({ cls: "agent-client-mcp-auth-notice" });

		root.createDiv({
			cls: "agent-client-mcp-auth-notice-title",
			text: t("notices.mcpNeedsSignInTitle", { server: entry.serverName }),
		});
		if (entry.host) {
			root.createDiv({
				cls: "agent-client-mcp-auth-notice-host",
				text: t("notices.mcpOpensHost", { host: entry.host }),
			});
		}

		const buttons = root.createDiv({
			cls: "agent-client-mcp-auth-notice-buttons",
		});
		if (entry.signInUnavailable) {
			root.createDiv({
				cls: "agent-client-mcp-auth-notice-host",
				text: t("notices.mcpSignInUnavailable"),
			});
		} else {
			const signIn = buttons.createEl("button", {
				cls: "mod-cta",
				text: t("notices.mcpSignIn"),
			});
			signIn.addEventListener("click", (e) => {
				// The whole Notice dismisses on click — keep it up until the
				// server actually initializes.
				e.stopPropagation();
				this.openSignIn(entry);
			});
		}
		if (entry.oauthUrl) {
			const copy = buttons.createEl("button", { text: t("notices.mcpCopyLink") });
			copy.addEventListener("click", (e) => {
				e.stopPropagation();
				void this.copySignInLink(entry);
			});
		}

		if (queued.length > 0) {
			const names = queued.map((q) => q.serverName).join(", ");
			root.createDiv({
				cls: "agent-client-mcp-auth-notice-queue",
				text: t("notices.mcpMoreWaiting", { count: queued.length, names }),
			});
		}

		if (entry.oauthUrl) {
			root.createDiv({
				cls: "agent-client-mcp-auth-notice-hint",
				text: t("modals.mcpAuth.linkExpiry"),
			});
		}

		return createFragment((fragment) => {
			fragment.appendChild(root);
		});
	}
}

function failureSignature(failures: McpServerFailure[]): string {
	return failures.map((f) => `${f.serverName}\u0000${f.message ?? ""}`).join("\u0001");
}
