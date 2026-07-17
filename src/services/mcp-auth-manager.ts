import { Notice } from "obsidian";

import type { McpAuthEvent, PendingMcpAuth } from "../types/mcp-auth";
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
 */

// ============================================================================
// Pure state core (exported for tests)
// ============================================================================

export interface McpAuthState {
	/** Insertion-ordered pending sign-ins, keyed by `viewId\u0000serverName`. */
	pending: Map<string, PendingMcpAuth & { viewId: string }>;
}

export function createMcpAuthState(): McpAuthState {
	return { pending: new Map() };
}

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
	const key = entryKey(viewId, event.serverName);
	switch (event.kind) {
		case "oauth_request": {
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
			return state.pending.delete(key);
		}
	}
}

// ============================================================================
// Manager (Notice lifecycle + subscriptions)
// ============================================================================

export class McpAuthManager {
	private state = createMcpAuthState();
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
		},
	): () => void {
		const unsubscribe = client.onMcpAuthEvent((event) => {
			this.handleEvent(viewId, event);
		});
		return () => {
			unsubscribe();
			this.dropView(viewId);
		};
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

	/** Open the sign-in page for a pending entry. User-initiated only. */
	openSignIn(entry: PendingMcpAuth): void {
		window.open(entry.oauthUrl);
	}

	/** Copy the sign-in link. User-initiated only. */
	async copySignInLink(entry: PendingMcpAuth): Promise<void> {
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
		const changed = reduceMcpAuth(this.state, viewId, event, Date.now());
		if (!changed) return;
		this.refreshNotice();
		this.emitChange();
	}

	/** Remove all pending entries for a closed view. */
	private dropView(viewId: string): void {
		let changed = false;
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
		const copy = buttons.createEl("button", { text: t("notices.mcpCopyLink") });
		copy.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.copySignInLink(entry);
		});

		if (queued.length > 0) {
			const names = queued.map((q) => q.serverName).join(", ");
			root.createDiv({
				cls: "agent-client-mcp-auth-notice-queue",
				text: t("notices.mcpMoreWaiting", { count: queued.length, names }),
			});
		}

		root.createDiv({
			cls: "agent-client-mcp-auth-notice-hint",
			text: t("modals.mcpAuth.linkExpiry"),
		});

		return createFragment((fragment) => {
			fragment.appendChild(root);
		});
	}
}
