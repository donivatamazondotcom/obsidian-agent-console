/**
 * `deriveSessionHistoryView` — the single pure resolver for the Session
 * History modal's gating decisions in Agent Console.
 *
 * WHY THIS EXISTS
 * The modal's surface used to be decided by a cluster of inline booleans that
 * had to agree but were maintained independently inside `SessionHistoryModal`:
 *   - `canPerformAnyOperation = isAgentReady && (canRestore || canFork)`
 *   - `canShowList = canList || isUsingLocalSessions || !canPerformAnyOperation`
 *   - per-row `canRestore = (isAgentReady && canRestore) || isUsingLocalSessions`
 *   - per-row `canFork = isAgentReady && canFork`
 *   - filter toggles gated on `canList && !isUsingLocalSessions`
 *   - a banner that said "Connect to an agent…" whenever the tab was not yet
 *     connected.
 * Each bug landed as another edit to one of those scattered predicates (I09,
 * I41, + the untracked filter-checkbox facet). This module is the one decision
 * every consumer reads.
 *
 * DESIGN (Track C of [[Resolver and Single-Writer Refactors]]; folds in the
 * settled design of [[Restore-fork gated on agent connection]]):
 *
 *  - Consumes the normalized {@link AgentCapabilities} record produced once at
 *    the `acp/` edge (Track B / I117) — never the raw SDK bag, never an
 *    assumed per-agent profile.
 *
 *  - Gates restore/fork on **data availability + capability + intent, NOT on
 *    whether the tab's agent is currently connected.** `isAgentReady` is taken
 *    as an input but MUST NOT change any output — the lazy-session model
 *    reconnects on first send, and the orchestration (ChatView
 *    `onOpenSessionInTab`) restores/forks into a tab that connects lazily. This
 *    supersedes the I09 "Connect to an agent…" gate and the I41 "does not
 *    support restoration" banner. The paired ready/not-ready truth-table rows
 *    are the regression guard against re-introducing connection-gating.
 *
 *  - `restore: "live"` when the agent advertises load/resume (the restore goes
 *    through an agent call); `"local-only"` when it does not but local data
 *    exists (load transcript from disk, reconnect lazily); `"hidden"` only when
 *    there is neither capability nor local data — the single state that
 *    suppresses the restore action.
 *
 *  - `fork: "available"` purely on the `forks` capability (the chosen tab does
 *    connect-then-fork, so connection is not a precondition for showing it).
 *
 * Pure — no React, no Obsidian. Total: every input cell maps to a known shape;
 * never throws. Safe to unit-test exhaustively.
 */
import type { AgentCapabilities } from "../types/session";

/** Where the session list is sourced from. */
export type SessionListSource =
	/** Agent advertises `session/list` — enumerate server-side sessions. */
	| "agent"
	/** Agent does not list — show plugin-local saved sessions. */
	| "local";

/**
 * Whether/how a session can be restored. Gated on capability + local data,
 * never on connection.
 */
export type RestoreAvailability =
	/** Agent advertises load/resume — restore via an agent call (lazy connect). */
	| "live"
	/** No load/resume capability, but local transcript exists — restore from disk. */
	| "local-only"
	/** Neither capability nor local data — the restore action is suppressed. */
	| "hidden";

/** Whether the fork action is shown. */
export type ForkAvailability =
	/** Agent advertises fork — shown (chosen tab does connect-then-fork). */
	| "available"
	/** Agent does not advertise fork — hidden. */
	| "hidden";

/** The informational/warning banner to show above the list, if any. */
export type SessionHistoryBanner =
	/** No banner. */
	| "none"
	/** "These sessions are saved in the plugin." (plugin-local list, restore works). */
	| "local-saved"
	/** "This agent does not support restoring sessions." (restore hidden). */
	| "no-restore-capability";

/**
 * The complete, normalized view decision the Session History modal renders
 * from. Every field is a tagged union — consumers switch on these instead of
 * recomputing inline booleans.
 */
export interface SessionHistoryView {
	/** Source of the session list (drives fetch + the filter facet). */
	listSource: SessionListSource;
	/** Whether the current-vault / hide-non-local filter checkboxes are shown. */
	showFilters: boolean;
	/** Whether/how the restore (▶) action is available. */
	restore: RestoreAvailability;
	/** Whether the fork (git-branch) action is shown. */
	fork: ForkAvailability;
	/** The banner to render above the list. */
	banner: SessionHistoryBanner;
}

/**
 * Resolve the Session History modal's gating decision from the normalized
 * agent capabilities, the (ignored-for-gating) connection readiness, and
 * whether local session data is available.
 *
 * @param capabilities - Normalized record from the `acp/` edge (Track B).
 * @param isAgentReady - Whether the tab's agent is connected. **Accepted but
 *   intentionally never consulted** — connection does not gate any output.
 *   Kept in the signature so the totality/invariance tests can prove it.
 * @param hasLocalData - Whether the plugin has local session data available
 *   to restore from (a non-empty local library / local list).
 */
export function deriveSessionHistoryView(
	capabilities: AgentCapabilities,
	isAgentReady: boolean,
	hasLocalData: boolean,
): SessionHistoryView {
	const listSource: SessionListSource = capabilities.listsSessions
		? "agent"
		: "local";

	// The filter checkboxes only make sense over an agent-enumerated list;
	// plugin-local lists (e.g. Kiro CLI) have no filters. Equivalent to the old
	// `canList && !isUsingLocalSessions`, which reduced to `listsSessions`.
	const showFilters = capabilities.listsSessions;

	const canRestoreViaAgent =
		capabilities.restoresViaLoad || capabilities.restoresViaResume;
	// A plugin-local list IS the local data — those sessions are restorable
	// from disk regardless of whether `hasLocalData` (the agent-list overlay,
	// populated by the fetch) is set yet. This keeps a local-source agent
	// (e.g. Kiro CLI) from transiently showing the "no restore capability"
	// banner before the first fetch resolves (RC-3). Restore is "hidden" only
	// for an AGENT-listed source with no restore capability and no local
	// transcript to fall back on.
	const restore: RestoreAvailability = canRestoreViaAgent
		? "live"
		: listSource === "local" || hasLocalData
			? "local-only"
			: "hidden";

	// Fork is agent-agnostic (RC-2): offered for ANY agent that has something
	// to branch (i.e. whenever restore is possible). `session/fork`-capable
	// agents get a true server-side branch; others get a local branch (a fresh
	// session seeded with the transcript, with the same "agent doesn't have
	// this history" transparency as a disk-only restore). That server-vs-local
	// choice is made at acquisition time (ChatPanel) from `capabilities.forks`;
	// visibility here does not gate on it.
	const fork: ForkAvailability =
		restore === "hidden" ? "hidden" : "available";

	const banner: SessionHistoryBanner =
		restore === "hidden"
			? "no-restore-capability"
			: listSource === "local"
				? "local-saved"
				: "none";

	return { listSource, showFilters, restore, fork, banner };
}
